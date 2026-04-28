// /financeiro/pagamentos — listagem de pagamentos do PDV com pedido em
// destaque + filtros pesados + edicao inline (bandeira, NSU, autorizacao).
//
// User pediu: 'a guia principal sera o pedido nao o cliente' + 'editar pagamento'.
// Esta tela e' a guia principal por pedido (cada linha = 1 pagamento, com
// pedido/mesa/cliente como contexto). Click 'Editar' abre modal de edicao
// dos campos seguros (forma e valor nao sao editaveis aqui).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, exists, gte, lte, notExists, or, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { PagamentosFiltros } from './filtros';
import { LinhaPagamento } from './linha-pagamento';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
  pedido?: string;
  mesa?: string;
  cliente?: string;
  forma?: string;
  bandeira?: string;
  nsu?: string;
  valorMin?: string;
  valorMax?: string;
  status?: string;
  page?: string;
}

const PAGE_SIZE = 100;

export default async function PagamentosPage(props: {
  searchParams: Promise<SP>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const dataIni = sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(7);
  const dataFim = sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim) ? sp.dataFim : hojeBr();
  const dtIni = new Date(dataIni + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');
  const page = Math.max(0, Number(sp.page ?? '0') || 0);

  const where = [
    eq(schema.pagamento.filialId, filialSelecionada.id),
    gte(schema.pagamento.dataPagamento, dtIni),
    lte(schema.pagamento.dataPagamento, dtFim),
  ];
  if (sp.pedido) {
    const n = Number(sp.pedido);
    if (Number.isFinite(n)) {
      where.push(eq(schema.pagamento.codigoPedidoExterno, n));
    }
  }
  if (sp.forma) where.push(eq(schema.pagamento.formaPagamento, sp.forma));
  if (sp.bandeira) {
    const cond = or(
      eq(schema.pagamento.bandeiraMfe, sp.bandeira),
      eq(schema.pagamento.bandeiraEfetiva, sp.bandeira),
    );
    if (cond) where.push(cond);
  }
  if (sp.nsu) where.push(eq(schema.pagamento.nsuTransacao, sp.nsu));
  const vMin = sp.valorMin ? Number(sp.valorMin) : null;
  const vMax = sp.valorMax ? Number(sp.valorMax) : null;
  if (vMin != null && Number.isFinite(vMin)) {
    where.push(gte(schema.pagamento.valor, String(vMin)));
  }
  if (vMax != null && Number.isFinite(vMax)) {
    where.push(lte(schema.pagamento.valor, String(vMax)));
  }
  // Filtro mesa precisa de subquery no pedido (mesa = pedido.tag).
  if (sp.mesa) {
    where.push(
      sql`EXISTS (
        SELECT 1 FROM ${schema.pedido} pd
        WHERE pd.filial_id = ${schema.pagamento.filialId}
          AND pd.codigo_externo = ${schema.pagamento.codigoPedidoExterno}
          AND pd.tag ILIKE ${'%' + sp.mesa + '%'}
      )`,
    );
  }
  if (sp.cliente) {
    where.push(
      sql`EXISTS (
        SELECT 1 FROM ${schema.pedido} pd
        WHERE pd.filial_id = ${schema.pagamento.filialId}
          AND pd.codigo_externo = ${schema.pagamento.codigoPedidoExterno}
          AND pd.nome_cliente ILIKE ${'%' + sp.cliente + '%'}
      )`,
    );
  }
  // Filtro status: aberto, casado-cielo, casado-banco, qualquer-casado.
  // Subqueries via EXISTS / NOT EXISTS.
  if (sp.status === 'aberto') {
    where.push(
      notExists(
        db
          .select({ id: schema.matchPdvCielo.id })
          .from(schema.matchPdvCielo)
          .where(eq(schema.matchPdvCielo.pagamentoId, schema.pagamento.id)),
      ),
    );
    where.push(
      notExists(
        db
          .select({ id: schema.matchPdvBanco.id })
          .from(schema.matchPdvBanco)
          .where(eq(schema.matchPdvBanco.pagamentoId, schema.pagamento.id)),
      ),
    );
  } else if (sp.status === 'cielo') {
    where.push(
      exists(
        db
          .select({ id: schema.matchPdvCielo.id })
          .from(schema.matchPdvCielo)
          .where(eq(schema.matchPdvCielo.pagamentoId, schema.pagamento.id)),
      ),
    );
  } else if (sp.status === 'banco') {
    where.push(
      exists(
        db
          .select({ id: schema.matchPdvBanco.id })
          .from(schema.matchPdvBanco)
          .where(eq(schema.matchPdvBanco.pagamentoId, schema.pagamento.id)),
      ),
    );
  } else if (sp.status === 'qualquer-casado') {
    const cond = or(
      exists(
        db
          .select({ id: schema.matchPdvCielo.id })
          .from(schema.matchPdvCielo)
          .where(eq(schema.matchPdvCielo.pagamentoId, schema.pagamento.id)),
      ),
      exists(
        db
          .select({ id: schema.matchPdvBanco.id })
          .from(schema.matchPdvBanco)
          .where(eq(schema.matchPdvBanco.pagamentoId, schema.pagamento.id)),
      ),
    );
    if (cond) where.push(cond);
  }

  // Total + soma do filtro
  const [stats] = await db
    .select({
      qtd: sql<number>`COUNT(*)::int`,
      soma: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
    })
    .from(schema.pagamento)
    .where(and(...where));

  // Lista paginada com JOINs (pedido + canal + flags de match)
  const pagamentos = await db
    .select({
      id: schema.pagamento.id,
      pedido: schema.pagamento.codigoPedidoExterno,
      pedidoNumero: schema.pedido.numero,
      pedidoMesa: schema.pedido.tag,
      pedidoNotaEmitida: schema.pedido.notaEmitida,
      nomeCliente: schema.pedido.nomeCliente,
      dataPagamento: schema.pagamento.dataPagamento,
      valor: schema.pagamento.valor,
      formaPagamento: schema.pagamento.formaPagamento,
      bandeiraMfe: schema.pagamento.bandeiraMfe,
      bandeiraEfetiva: schema.pagamento.bandeiraEfetiva,
      nsuTransacao: schema.pagamento.nsuTransacao,
      numeroAutorizacaoCartao: schema.pagamento.numeroAutorizacaoCartao,
      canalConciliacao: schema.formaPagamentoCanal.canal,
      casadoCielo: sql<boolean>`EXISTS (
        SELECT 1 FROM ${schema.matchPdvCielo} m
        WHERE m.pagamento_id = ${schema.pagamento.id}
      )`,
      casadoBanco: sql<boolean>`EXISTS (
        SELECT 1 FROM ${schema.matchPdvBanco} m
        WHERE m.pagamento_id = ${schema.pagamento.id}
      )`,
    })
    .from(schema.pagamento)
    .leftJoin(
      schema.pedido,
      and(
        eq(schema.pedido.filialId, schema.pagamento.filialId),
        eq(schema.pedido.codigoExterno, schema.pagamento.codigoPedidoExterno),
      ),
    )
    .leftJoin(
      schema.formaPagamentoCanal,
      and(
        eq(schema.formaPagamentoCanal.filialId, schema.pagamento.filialId),
        eq(schema.formaPagamentoCanal.formaPagamento, schema.pagamento.formaPagamento),
      ),
    )
    .where(and(...where))
    .orderBy(desc(schema.pagamento.dataPagamento))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  const totalQtd = Number(stats?.qtd ?? 0);
  const totalSoma = Number(stats?.soma ?? 0);
  const totalPaginas = Math.ceil(totalQtd / PAGE_SIZE);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Pagamentos do PDV</h1>
        <p className="mt-1 text-sm text-slate-600">
          Lista de pagamentos por pedido. Filtra por data, pedido, mesa, cliente,
          forma, bandeira, NSU, valor, status de conciliação. Click em
          <strong> Editar </strong> pra corrigir bandeira/NSU/autorização (forma
          e valor não são editáveis aqui — afetam canal de conciliação).
        </p>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <PagamentosFiltros
            sp={sp}
            filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            <strong>{int(totalQtd)}</strong> pagamento{totalQtd !== 1 ? 's' : ''} no
            filtro · soma <strong>{brl(totalSoma)}</strong>
            {totalPaginas > 1 && (
              <span className="ml-2">
                · página {page + 1} de {totalPaginas}
              </span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Pedido / Mesa</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Forma</th>
                <th className="px-3 py-2">Bandeira</th>
                <th className="px-3 py-2">NSU / Auth</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {pagamentos.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500">
                    Nenhum pagamento com os filtros atuais.
                  </td>
                </tr>
              ) : (
                pagamentos.map((p) => (
                  <LinhaPagamento
                    key={p.id}
                    p={{
                      id: p.id,
                      pedido: p.pedido,
                      pedidoNumero: p.pedidoNumero,
                      pedidoMesa: p.pedidoMesa,
                      pedidoNotaEmitida: p.pedidoNotaEmitida,
                      nomeCliente: p.nomeCliente,
                      dataPagamento: p.dataPagamento,
                      valor: Number(p.valor),
                      formaPagamento: p.formaPagamento,
                      bandeiraMfe: p.bandeiraMfe,
                      bandeiraEfetiva: p.bandeiraEfetiva,
                      nsuTransacao: p.nsuTransacao,
                      numeroAutorizacaoCartao: p.numeroAutorizacaoCartao,
                      canalConciliacao: p.canalConciliacao,
                      casadoCielo: p.casadoCielo,
                      casadoBanco: p.casadoBanco,
                    }}
                  />
                ))
              )}
            </tbody>
          </table>

          {totalPaginas > 1 && (
            <div className="flex justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
              <span>
                Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalQtd)} de{' '}
                {int(totalQtd)}
              </span>
              <div className="flex gap-2">
                {page > 0 && (
                  <a
                    href={`?${makeQs({ ...sp, page: String(page - 1) })}`}
                    className="rounded border border-slate-300 px-2 py-0.5 hover:bg-white"
                  >
                    Anterior
                  </a>
                )}
                {page < totalPaginas - 1 && (
                  <a
                    href={`?${makeQs({ ...sp, page: String(page + 1) })}`}
                    className="rounded border border-slate-300 px-2 py-0.5 hover:bg-white"
                  >
                    Próxima
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function makeQs(sp: SP): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v) qs.set(k, String(v));
  }
  return qs.toString();
}
