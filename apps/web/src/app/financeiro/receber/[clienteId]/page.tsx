// Detalhe de fiado de um cliente: lista de movimentos com filtros (data,
// pedido, valor, modalidade, NSU). Cada movimento mostra a forma de
// pagamento e NSU quando vem do PDV (JOIN com pagamento via codigo).

import { Fragment } from 'react';
import { notFound, redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDateTime, int } from '@/lib/format';
import { LancarFiado } from './lancar-fiado';
import { ClienteFiltros } from './filtros';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
  pedido?: string;
  mesa?: string;
  valorMin?: string;
  valorMax?: string;
  modalidade?: string;
  nsu?: string;
  q?: string;
}

const PAGE_SIZE = 200;

export default async function ClienteFiadoPage(props: {
  params: Promise<{ clienteId: string }>;
  searchParams: Promise<SP>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'conta_receber.read');

  const { clienteId } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(clienteId)) notFound();

  const sp = await props.searchParams;

  const filiais = await filiaisDoUsuario(user.id);
  const filiaisIds = filiais.map((f) => f.id);

  // Cliente (RBAC: filial precisa ser acessivel)
  const [cli] = await db
    .select({
      id: schema.cliente.id,
      filialId: schema.cliente.filialId,
      codigoExterno: schema.cliente.codigoExterno,
      nome: schema.cliente.nome,
      cpfOuCnpj: schema.cliente.cpfOuCnpj,
      saldoCadastro: schema.cliente.saldoAtualContaCorrente,
    })
    .from(schema.cliente)
    .where(eq(schema.cliente.id, clienteId))
    .limit(1);
  if (!cli || !filiaisIds.includes(cli.filialId)) notFound();

  const filialAtual = filiais.find((f) => f.id === cli.filialId);

  // Filtros pra movimento
  const where = [
    eq(schema.movimentoContaCorrente.filialId, cli.filialId),
    or(
      eq(schema.movimentoContaCorrente.clienteId, cli.id),
      cli.codigoExterno != null
        ? eq(schema.movimentoContaCorrente.codigoClienteExterno, cli.codigoExterno)
        : undefined,
    ),
  ];
  if (sp.dataIni && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataIni)) {
    where.push(
      gte(schema.movimentoContaCorrente.dataHora, new Date(sp.dataIni + 'T00:00:00-03:00')),
    );
  }
  if (sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim)) {
    where.push(
      lte(schema.movimentoContaCorrente.dataHora, new Date(sp.dataFim + 'T23:59:59-03:00')),
    );
  }
  if (sp.pedido && sp.pedido.trim()) {
    const n = Number(sp.pedido.trim());
    if (Number.isFinite(n)) {
      where.push(eq(schema.movimentoContaCorrente.codigoPedidoExterno, n));
    }
  }
  const vMin = sp.valorMin ? Number(sp.valorMin) : null;
  const vMax = sp.valorMax ? Number(sp.valorMax) : null;
  if (vMin != null && Number.isFinite(vMin)) {
    where.push(
      or(
        gte(schema.movimentoContaCorrente.credito, String(vMin)),
        gte(schema.movimentoContaCorrente.debito, String(vMin)),
      ),
    );
  }
  if (vMax != null && Number.isFinite(vMax)) {
    where.push(
      and(
        lte(schema.movimentoContaCorrente.credito, String(vMax)),
        lte(schema.movimentoContaCorrente.debito, String(vMax)),
      ),
    );
  }
  if (sp.q && sp.q.trim()) {
    const q = sp.q.trim();
    where.push(sql`extensions.unaccent(${schema.movimentoContaCorrente.observacao}) ILIKE extensions.unaccent(${'%' + q + '%'})`);
  }
  if (sp.modalidade && sp.modalidade.trim()) {
    where.push(eq(schema.pagamento.formaPagamento, sp.modalidade.trim()));
  }
  if (sp.nsu && sp.nsu.trim()) {
    where.push(eq(schema.pagamento.nsuTransacao, sp.nsu.trim()));
  }
  if (sp.mesa && sp.mesa.trim()) {
    where.push(sql`extensions.unaccent(${schema.pedido.tag}) ILIKE extensions.unaccent(${'%' + sp.mesa.trim() + '%'})`);
  }

  // Movimentos com JOIN no pagamento (forma + NSU + bandeira) e no pedido
  // (numero + tag = mesa/comanda). Pedido eh o eixo principal — user disse
  // que "o principal eh o pedido, ja que nao usamos muito a identificacao
  // do cliente, a mesa tambem e importante".
  const movimentos = await db
    .select({
      id: schema.movimentoContaCorrente.id,
      codigoExterno: schema.movimentoContaCorrente.codigoExterno,
      codigoPedidoExterno: schema.movimentoContaCorrente.codigoPedidoExterno,
      dataHora: schema.movimentoContaCorrente.dataHora,
      credito: schema.movimentoContaCorrente.credito,
      debito: schema.movimentoContaCorrente.debito,
      saldoFinal: schema.movimentoContaCorrente.saldoFinal,
      observacao: schema.movimentoContaCorrente.observacao,
      pagamentoForma: schema.pagamento.formaPagamento,
      pagamentoBandeira: schema.pagamento.bandeiraMfe,
      pagamentoNsu: schema.pagamento.nsuTransacao,
      pagamentoAutorizacao: schema.pagamento.numeroAutorizacaoCartao,
      pedidoNumero: schema.pedido.numero,
      pedidoMesa: schema.pedido.tag,
      pedidoValorTotal: schema.pedido.valorTotal,
      pedidoColaborador: schema.pedido.codigoColaborador,
      pedidoNotaEmitida: schema.pedido.notaEmitida,
    })
    .from(schema.movimentoContaCorrente)
    .leftJoin(
      schema.pagamento,
      and(
        eq(schema.pagamento.filialId, schema.movimentoContaCorrente.filialId),
        eq(schema.pagamento.codigoExterno, schema.movimentoContaCorrente.codigoPagamento),
      ),
    )
    .leftJoin(
      schema.pedido,
      and(
        eq(schema.pedido.filialId, schema.movimentoContaCorrente.filialId),
        eq(schema.pedido.codigoExterno, schema.movimentoContaCorrente.codigoPedidoExterno),
      ),
    )
    .where(and(...where))
    .orderBy(desc(schema.movimentoContaCorrente.dataHora))
    .limit(PAGE_SIZE);

  // PRODUTOS de cada pedido que aparece no extrato. "O cliente deve R$ X" só
  // vira conversa quando dá pra mostrar O QUE ele consumiu — e é a mesma
  // pergunta que aparece quando ele contesta a dívida. Uma consulta só pros
  // pedidos da página (índice idx_pedido_item_pedido), não uma por linha.
  const pedidosNaTela = Array.from(
    new Set(movimentos.map((m) => m.codigoPedidoExterno).filter((n): n is number => n != null)),
  );
  const itensPorPedido = new Map<
    number,
    Array<{ nome: string; qtd: number; valor: number; filhos: string[] }>
  >();
  if (pedidosNaTela.length > 0) {
    const itens = await db
      .select({
        pedido: schema.pedidoItem.codigoPedidoExterno,
        codigo: schema.pedidoItem.codigoExterno,
        pai: schema.pedidoItem.codigoPai,
        nome: schema.pedidoItem.nomeProduto,
        qtd: schema.pedidoItem.quantidade,
        valor: schema.pedidoItem.valorTotal,
      })
      .from(schema.pedidoItem)
      .where(
        and(
          eq(schema.pedidoItem.filialId, cli.filialId),
          inArray(schema.pedidoItem.codigoPedidoExterno, pedidosNaTela),
          isNull(schema.pedidoItem.dataDelete),
        ),
      )
      .orderBy(asc(schema.pedidoItem.codigoExterno));
    // filho (codigo_pai) é resposta do wizard/complemento — vira detalhe do pai,
    // não linha própria: "1× Picanha · ao ponto", igual o KDS mostra.
    const porCodigo = new Map<number, { nome: string; qtd: number; valor: number; filhos: string[] }>();
    for (const it of itens) {
      if (it.pai != null) continue;
      const linha = {
        nome: (it.nome ?? 'item').trim(),
        qtd: Number(it.qtd ?? 1),
        valor: Number(it.valor ?? 0),
        filhos: [] as string[],
      };
      porCodigo.set(it.codigo, linha);
      const lista = itensPorPedido.get(it.pedido) ?? [];
      lista.push(linha);
      itensPorPedido.set(it.pedido, lista);
    }
    for (const it of itens) {
      if (it.pai == null) continue;
      const pai = porCodigo.get(it.pai);
      const nome = (it.nome ?? '').trim();
      if (!pai || !nome || /^nenhum$/i.test(nome)) continue;
      if (!pai.filhos.includes(nome)) pai.filhos.push(nome);
      pai.valor += Number(it.valor ?? 0);
    }
  }

  // Saldo total do cliente (sem aplicar filtros — sempre mostra o saldo real).
  // ⚠️ credito - debito NÃO dá o saldo: o pagamento é gravado como DEBITO
  // NEGATIVO, então subtrair somava o pagamento. Quem manda é o saldo corrido
  // do cadastro (o mesmo número da tela do Consumer); a soma abaixo fica só
  // pros totais de crédito/pagamento e como reserva.
  const [saldoRow] = await db
    .select({
      saldo: sql<string>`COALESCE(SUM(${schema.movimentoContaCorrente.credito}), 0) + COALESCE(SUM(${schema.movimentoContaCorrente.debito}), 0)`,
      totalCredito: sql<string>`COALESCE(SUM(${schema.movimentoContaCorrente.credito}), 0)`,
      totalDebito: sql<string>`COALESCE(SUM(${schema.movimentoContaCorrente.debito}), 0)`,
      qtdTotal: sql<number>`COUNT(*)::int`,
    })
    .from(schema.movimentoContaCorrente)
    .where(
      and(
        eq(schema.movimentoContaCorrente.filialId, cli.filialId),
        or(
          eq(schema.movimentoContaCorrente.clienteId, cli.id),
          cli.codigoExterno != null
            ? eq(schema.movimentoContaCorrente.codigoClienteExterno, cli.codigoExterno)
            : undefined,
        ),
      ),
    );
  const saldoMovs = Number(saldoRow?.saldo ?? 0);
  const saldo = cli.saldoCadastro != null ? Number(cli.saldoCadastro) : saldoMovs;

  // Lançamentos que a tela criou e a loja ainda não aplicou (ou deram erro).
  // Sem mostrar isto, quem lança acha que sumiu — a fila roda a cada ~1 min.
  const pendentes = cli.codigoExterno == null ? [] : await db
    .select({
      id: schema.fiadoLancamento.id,
      tipo: schema.fiadoLancamento.tipo,
      valor: schema.fiadoLancamento.valor,
      erro: schema.fiadoLancamento.erro,
      formaNome: schema.fiadoLancamento.formaNome,
      condicao: schema.fiadoLancamento.condicao,
      vencimento: schema.fiadoLancamento.vencimento,
    })
    .from(schema.fiadoLancamento)
    .where(
      and(
        eq(schema.fiadoLancamento.filialId, cli.filialId),
        eq(schema.fiadoLancamento.clienteCodigoExterno, cli.codigoExterno),
        inArray(schema.fiadoLancamento.status, ['pendente', 'erro']),
      ),
    )
    .orderBy(desc(schema.fiadoLancamento.criadoEm))
    .limit(5);
  const totalCredito = Number(saldoRow?.totalCredito ?? 0);
  const totalDebito = Number(saldoRow?.totalDebito ?? 0);
  const qtdTotal = Number(saldoRow?.qtdTotal ?? 0);

  // Soma dos filtrados (pode bater com saldo se sem filtros)
  const somaCredFiltrados = movimentos.reduce(
    (s, m) => s + Number(m.credito ?? 0),
    0,
  );
  const somaDebFiltrados = movimentos.reduce(
    (s, m) => s + Number(m.debito ?? 0),
    0,
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <nav className="text-xs text-slate-500">
          <Link href={`/financeiro/receber?filialId=${cli.filialId}`} className="hover:text-slate-800">
            ← Contas a receber
          </Link>
          {filialAtual && <span className="ml-2 text-slate-400">· {filialAtual.nome}</span>}
        </nav>

        <h1 className="mt-2 text-2xl font-bold text-slate-900">{cli.nome ?? 'Cliente'}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {cli.cpfOuCnpj ? <span className="font-mono">{cli.cpfOuCnpj}</span> : 'Sem CPF/CNPJ'}
          {cli.codigoExterno != null && (
            <span className="ml-2 text-slate-500">· cód {cli.codigoExterno}</span>
          )}
        </p>

        <LancarFiado clienteId={cli.id} saldo={saldo} />

        {/* Lançamentos ainda não aplicados na loja (a fila roda a cada ~1 min) */}
        {pendentes.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">Aguardando a loja aplicar</p>
            <ul className="mt-2 space-y-1 text-sm text-amber-900">
              {pendentes.map((p) => (
                <li key={p.id}>
                  {p.tipo === 'pagamento' ? 'Pagamento' : 'Crédito'} de {brl(Number(p.valor))}
                  {p.formaNome && <span className="text-amber-800"> · {p.formaNome}</span>}
                  {p.condicao === 'prazo' && p.vencimento && (
                    <span className="text-amber-800"> · vence {p.vencimento.split('-').reverse().join('/')}</span>
                  )}
                  {p.condicao === 'avista' && <span className="text-amber-800"> · à vista</span>}
                  {p.erro ? <span className="ml-2 font-semibold text-rose-700">erro: {p.erro}</span> : ' · na fila'}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* KPIs */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div
            className={`rounded-xl border p-4 ${
              saldo > 0.01
                ? 'border-rose-200 bg-rose-50'
                : saldo < -0.01
                  ? 'border-blue-200 bg-blue-50'
                  : 'border-slate-200 bg-white'
            }`}
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Saldo atual
            </p>
            <p
              className={`mt-1 text-2xl font-bold ${
                saldo > 0.01
                  ? 'text-rose-700'
                  : saldo < -0.01
                    ? 'text-blue-800'
                    : 'text-slate-700'
              }`}
            >
              {brl(saldo)}
            </p>
            <p className="text-xs text-slate-500">
              {saldo > 0.01 ? 'cliente deve' : saldo < -0.01 ? 'cliente é credor' : 'zerado'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Total creditado
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{brl(totalCredito)}</p>
            <p className="text-xs text-slate-500">vendas a fiado</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Total pago
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{brl(totalDebito)}</p>
            <p className="text-xs text-slate-500">pagamentos recebidos</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Movimentos
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{int(qtdTotal)}</p>
            <p className="text-xs text-slate-500">total no histórico</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <ClienteFiltros sp={sp} filialId={cli.filialId} />
        </div>

        {/* Tabela */}
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            Mostrando {int(movimentos.length)} movimento{movimentos.length !== 1 ? 's' : ''}
            {(sp.dataIni ||
              sp.dataFim ||
              sp.pedido ||
              sp.valorMin ||
              sp.valorMax ||
              sp.modalidade ||
              sp.nsu ||
              sp.q) && (
              <>
                {' '}· créd: <strong>{brl(somaCredFiltrados)}</strong> · pago:{' '}
                <strong>{brl(somaDebFiltrados)}</strong>
              </>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Pedido / Mesa</th>
                <th className="px-4 py-2">Modalidade</th>
                <th className="px-4 py-2">NSU / Auth</th>
                <th className="px-4 py-2 text-right text-rose-700">Crédito (dívida)</th>
                <th className="px-4 py-2 text-right text-blue-800">Débito (pago)</th>
                <th className="px-4 py-2 text-right">Saldo</th>
                <th className="px-4 py-2">Observação</th>
              </tr>
            </thead>
            <tbody>
              {movimentos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">
                    Nenhum movimento com os filtros atuais.
                  </td>
                </tr>
              ) : (
                movimentos.map((m) => {
                  const cred = Number(m.credito ?? 0);
                  const deb = Number(m.debito ?? 0);
                  const itens = m.codigoPedidoExterno ? itensPorPedido.get(m.codigoPedidoExterno) : undefined;
                  return (
                    <Fragment key={m.id}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {formatDateTime(m.dataHora)}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {m.codigoPedidoExterno ? (
                          <div className="flex flex-col leading-tight">
                            <span className="font-mono font-semibold text-slate-900">
                              #{m.pedidoNumero ?? m.codigoPedidoExterno}
                            </span>
                            {m.pedidoMesa && (
                              <span className="text-[10px] text-slate-500">
                                {m.pedidoMesa}
                              </span>
                            )}
                            {m.pedidoNotaEmitida && (
                              <span className="text-[9px] uppercase text-emerald-600">
                                ✓ NF emitida
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-700">
                        {m.pagamentoForma ?? (cred > 0 ? 'Fiado (crédito)' : '—')}
                        {m.pagamentoBandeira && (
                          <span className="ml-1 text-slate-400">· {m.pagamentoBandeira}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">
                        {m.pagamentoNsu ? (
                          <>
                            {m.pagamentoNsu}
                            {m.pagamentoAutorizacao && (
                              <span className="ml-1 text-slate-400">/ {m.pagamentoAutorizacao}</span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {cred > 0 ? <span className="text-rose-700">{brl(cred)}</span> : '—'}
                      </td>
                      {/* ⚠️ o pagamento vem com DÉBITO NEGATIVO no Consumer: sem o
                          módulo a coluna ficava vazia justo nas linhas de pagamento */}
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {Math.abs(deb) > 0.001 ? (
                          <span className="text-blue-800">{brl(Math.abs(deb))}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {m.saldoFinal != null ? (
                          <span
                            className={
                              Number(m.saldoFinal) > 0.01
                                ? 'font-semibold text-rose-700'
                                : 'text-blue-800'
                            }
                          >
                            {brl(Number(m.saldoFinal))}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-600">
                        <span
                          className="block max-w-md truncate"
                          title={m.observacao ?? ''}
                        >
                          {m.observacao ?? '—'}
                        </span>
                      </td>
                    </tr>
                    {/* O QUE ele consumiu: sem isto a dívida é um número solto
                        e não dá pra responder cliente que contesta a conta. */}
                    {itens && itens.length > 0 && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={8} className="px-4 pb-3 pt-0">
                          <details className="text-xs">
                            <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-800">
                              {itens.length} produto{itens.length !== 1 ? 's' : ''} no pedido #
                              {m.pedidoNumero ?? m.codigoPedidoExterno}
                            </summary>
                            <ul className="mt-2 max-w-2xl divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                              {itens.map((it, i) => (
                                <li key={i} className="flex items-baseline justify-between gap-4 px-3 py-1.5">
                                  <span className="text-slate-700">
                                    <span className="font-mono text-slate-500">
                                      {it.qtd % 1 === 0 ? it.qtd : it.qtd.toFixed(3)}×
                                    </span>{' '}
                                    {it.nome}
                                    {it.filhos.length > 0 && (
                                      <span className="text-slate-400"> · {it.filhos.join(' · ')}</span>
                                    )}
                                  </span>
                                  <span className="shrink-0 font-mono text-slate-600">{brl(it.valor)}</span>
                                </li>
                              ))}
                              <li className="flex items-baseline justify-between gap-4 bg-slate-50 px-3 py-1.5 font-medium">
                                <span className="text-slate-600">Soma dos itens</span>
                                <span className="font-mono text-slate-800">
                                  {brl(itens.reduce((t, it) => t + it.valor, 0))}
                                </span>
                              </li>
                            </ul>
                          </details>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
          {movimentos.length === PAGE_SIZE && (
            <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs text-slate-500">
              Mostrando os últimos {PAGE_SIZE}. Use filtros pra refinar.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
