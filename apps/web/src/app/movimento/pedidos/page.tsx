import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, count, desc, eq, gte, isNull, lte, sql, sum, ne } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDateTime, int } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
  page?: string;
}

const PAGE_SIZE = 100;

export default async function PedidosPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const dataIni = sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(7);
  const dataFim = sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim) ? sp.dataFim : hojeBr();
  const page = Math.max(0, Number(sp.page ?? '0') || 0);

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

  const dtIni = new Date(dataIni + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');

  const where = and(
    eq(schema.pedido.filialId, filialSelecionada.id),
    isNull(schema.pedido.dataDelete),
    gte(schema.pedido.dataFechamento, dtIni),
    lte(schema.pedido.dataFechamento, dtFim),
  );

  const [stats] = await db
    .select({
      qtd: count(),
      total: sum(schema.pedido.valorTotal),
      totalItens: sum(schema.pedido.valorTotalItens),
      totalServico: sum(schema.pedido.totalServico),
      totalDesconto: sum(schema.pedido.totalDesconto),
    })
    .from(schema.pedido)
    .where(where);

  const pedidos = await db
    .select({
      id: schema.pedido.id,
      codigoExterno: schema.pedido.codigoExterno,
      numero: schema.pedido.numero,
      dataAbertura: schema.pedido.dataAbertura,
      dataFechamento: schema.pedido.dataFechamento,
      nomeCliente: schema.pedido.nomeCliente,
      valorTotal: schema.pedido.valorTotal,
      valorTotalItens: schema.pedido.valorTotalItens,
      totalServico: schema.pedido.totalServico,
      totalDesconto: schema.pedido.totalDesconto,
      valorEntrega: schema.pedido.valorEntrega,
      quantidadePessoas: schema.pedido.quantidadePessoas,
      notaEmitida: schema.pedido.notaEmitida,
      tag: schema.pedido.tag,
    })
    .from(schema.pedido)
    .where(where)
    .orderBy(desc(schema.pedido.dataFechamento))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  // Top produtos no período
  const topProdutos = await db
    .select({
      nome: schema.pedidoItem.nomeProduto,
      qtd: sql<string>`COALESCE(SUM(${schema.pedidoItem.quantidade}), 0)::text`,
      valor: sql<string>`COALESCE(SUM(${schema.pedidoItem.valorTotal}), 0)::text`,
    })
    .from(schema.pedidoItem)
    .innerJoin(schema.pedido, eq(schema.pedido.id, schema.pedidoItem.pedidoId))
    .where(
      and(
        eq(schema.pedido.filialId, filialSelecionada.id),
        isNull(schema.pedidoItem.dataDelete),
        isNull(schema.pedido.dataDelete),
        gte(schema.pedido.dataFechamento, dtIni),
        lte(schema.pedido.dataFechamento, dtFim),
        ne(schema.pedidoItem.codigoItemPedidoTipo, 4), // exclui cortesia se for esse codigo
      ),
    )
    .groupBy(schema.pedidoItem.nomeProduto)
    .orderBy(sql`3 DESC`)
    .limit(10);

  const totalPag = Math.max(1, Math.ceil(Number(stats?.qtd ?? 0) / PAGE_SIZE));
  const ticketMedio = Number(stats?.qtd ?? 0) > 0
    ? Number(stats?.total ?? 0) / Number(stats?.qtd ?? 0)
    : 0;

  const hrefPag = (p: number) => {
    const qs = new URLSearchParams();
    qs.set('filialId', filialSelecionada.id);
    if (dataIni) qs.set('dataIni', dataIni);
    if (dataFim) qs.set('dataFim', dataFim);
    if (p > 0) qs.set('page', String(p));
    return `/movimento/pedidos?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Pedidos / Vendas</h1>
        <p className="mt-1 text-sm text-slate-600">
          Histórico de pedidos do PDV na {filialSelecionada.nome}.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/movimento/pedidos?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === filialSelecionada.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        <form method="GET" className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="filialId" value={filialSelecionada.id} />
          <label className="text-xs text-slate-600">
            De
            <input
              type="date"
              name="dataIni"
              defaultValue={dataIni}
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Até
            <input
              type="date"
              name="dataFim"
              defaultValue={dataFim}
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Filtrar
          </button>
        </form>

        {/* KPIs */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Pedidos
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{int(Number(stats?.qtd ?? 0))}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
              Faturamento
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{brl(Number(stats?.total ?? 0))}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Ticket médio
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{brl(ticketMedio)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Gorjetas
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{brl(Number(stats?.totalServico ?? 0))}</p>
          </div>
        </div>

        {/* Top produtos */}
        {topProdutos.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Top 10 produtos no período</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Produto</th>
                  <th className="px-4 py-2 text-right w-24">Qtd</th>
                  <th className="px-4 py-2 text-right w-36">Faturado</th>
                </tr>
              </thead>
              <tbody>
                {topProdutos.map((t, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-xs text-slate-800">{t.nome ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                      {Number(t.qtd).toFixed(Number(t.qtd) % 1 === 0 ? 0 : 2)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                      {brl(Number(t.valor))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Lista pedidos */}
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Pedidos do período</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Fechamento</th>
                <th className="px-4 py-2">Nº</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Pessoas</th>
                <th className="px-4 py-2 text-right">Itens</th>
                <th className="px-4 py-2 text-right">Serviço</th>
                <th className="px-4 py-2 text-right">Desconto</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">NF</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-xs text-slate-500">
                    Nenhum pedido no período.
                  </td>
                </tr>
              ) : (
                pedidos.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">
                      {formatDateTime(p.dataFechamento)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{p.numero ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-slate-700">
                      {p.nomeCliente ?? <span className="text-slate-400">—</span>}
                      {p.tag && <span className="ml-1 text-[10px] text-slate-400">[{p.tag}]</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                      {p.quantidadePessoas ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                      {brl(p.valorTotalItens)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
                      {brl(p.totalServico)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-rose-600">
                      {Number(p.totalDesconto ?? 0) > 0 ? `-${brl(p.totalDesconto)}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                      {brl(p.valorTotal)}
                    </td>
                    <td className="px-4 py-2">
                      {p.notaEmitida ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                          ✓ NFC-e
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {totalPag > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
              <span className="text-slate-600">
                Página {page + 1} de {totalPag} · {int(Number(stats?.qtd ?? 0))} pedidos
              </span>
              <div className="flex gap-2">
                {page > 0 ? (
                  <Link href={hrefPag(page - 1)} className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-white">
                    ← Anterior
                  </Link>
                ) : (
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">← Anterior</span>
                )}
                {page < totalPag - 1 ? (
                  <Link href={hrefPag(page + 1)} className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:bg-white">
                    Próxima →
                  </Link>
                ) : (
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">Próxima →</span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
