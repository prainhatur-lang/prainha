// Espelho do pedido: itens com tempos de PRONTO e ENTREGUE (toques do KDS da
// loja), cancelamentos com motivo/autorização, totais e pagamentos.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';

export const dynamic = 'force-dynamic';

function hora(d: Date | string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dataHora(d: Date | string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** minutos entre dois instantes, formatado ("12 min" / "1h05") */
function duracao(de: Date | string | null, ate: Date | string | null): string | null {
  if (!de || !ate) return null;
  const min = Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 60000);
  if (min < 0) return null;
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

export default async function EspelhoPedidoPage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conciliacao.read');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [pedido] = await db.select().from(schema.pedido).where(eq(schema.pedido.id, id)).limit(1);
  if (!pedido) notFound();

  const filiais = await filiaisDoUsuario(user.id);
  const filial = filiais.find((f) => f.id === pedido.filialId);
  if (!filial) redirect('/movimento/pedidos');

  const itens = await db
    .select({
      id: schema.pedidoItem.id,
      codigoExterno: schema.pedidoItem.codigoExterno,
      codigoPai: schema.pedidoItem.codigoPai,
      nome: schema.pedidoItem.nomeProduto,
      quantidade: schema.pedidoItem.quantidade,
      valorUnitario: schema.pedidoItem.valorUnitario,
      valorTotal: schema.pedidoItem.valorTotal,
      detalhes: schema.pedidoItem.detalhes,
      lancadoEm: schema.pedidoItem.dataHoraCadastro,
      prontoEm: schema.pedidoItem.prontoEm,
      entregueEm: schema.pedidoItem.entregueEm,
      cancelado: schema.pedidoItem.dataDelete,
    })
    .from(schema.pedidoItem)
    .where(
      and(
        eq(schema.pedidoItem.filialId, pedido.filialId),
        eq(schema.pedidoItem.codigoPedidoExterno, pedido.codigoExterno),
      ),
    )
    .orderBy(asc(schema.pedidoItem.dataHoraCadastro));

  const cancelamentos = await db
    .select({
      quando: schema.cancelamentoItem.quando,
      tipo: schema.cancelamentoItem.tipo,
      login: schema.cancelamentoItem.login,
      gerente: schema.cancelamentoItem.gerente,
      itemCodigo: schema.cancelamentoItem.itemCodigo,
      nome: schema.cancelamentoItem.nome,
      valor: schema.cancelamentoItem.valor,
      statusItem: schema.cancelamentoItem.statusItem,
      motivo: schema.cancelamentoItem.motivo,
    })
    .from(schema.cancelamentoItem)
    .where(
      and(
        eq(schema.cancelamentoItem.filialId, pedido.filialId),
        eq(schema.cancelamentoItem.pedidoFb, pedido.codigoExterno),
      ),
    )
    .orderBy(asc(schema.cancelamentoItem.quando));

  const pagamentos = await db
    .select({
      forma: schema.pagamento.formaPagamento,
      valor: schema.pagamento.valor,
      data: schema.pagamento.dataPagamento,
      nsu: schema.pagamento.nsuTransacao,
      bandeira: schema.pagamento.bandeiraMfe,
    })
    .from(schema.pagamento)
    .where(
      and(
        eq(schema.pagamento.filialId, pedido.filialId),
        eq(schema.pagamento.codigoPedidoExterno, pedido.codigoExterno),
      ),
    )
    .orderBy(asc(schema.pagamento.dataPagamento));

  const canceladoInteiro = cancelamentos.some((c) => c.tipo === 'pedido');
  const motivoCancelPorItem = new Map<number, (typeof cancelamentos)[number]>();
  for (const c of cancelamentos) if (c.itemCodigo != null) motivoCancelPorItem.set(c.itemCodigo, c);

  const totalPago = pagamentos.reduce((s, p) => s + Number(p.valor ?? 0), 0);
  const temKds = itens.some((i) => i.prontoEm || i.entregueEm);

  const linhaResumo = [
    { label: 'Itens', valor: brl(Number(pedido.valorTotalItens ?? 0)) },
    { label: 'Serviço', valor: brl(Number(pedido.totalServico ?? 0)) },
    ...(Number(pedido.totalDesconto ?? 0) > 0
      ? [{ label: 'Desconto', valor: `−${brl(Number(pedido.totalDesconto))}` }]
      : []),
    ...(Number(pedido.totalAcrescimo ?? 0) > 0
      ? [{ label: 'Acréscimo', valor: brl(Number(pedido.totalAcrescimo)) }]
      : []),
    ...(Number(pedido.valorEntrega ?? 0) > 0
      ? [{ label: 'Entrega', valor: brl(Number(pedido.valorEntrega)) }]
      : []),
    { label: 'Total', valor: brl(Number(pedido.valorTotal ?? 0)), destaque: true },
    { label: 'Pago', valor: brl(totalPago) },
  ];

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link href="/movimento/pedidos" className="text-xs text-sky-700 hover:underline">
              ← Pedidos e vendas
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              Pedido #{pedido.codigoExterno}
              {pedido.numero != null && (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  mesa/comanda {pedido.numero}
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {filial.nome}
              {pedido.nomeCliente ? ` · ${pedido.nomeCliente}` : ''}
              {pedido.quantidadePessoas ? ` · ${pedido.quantidadePessoas} pessoa(s)` : ''}
              {' · '}aberto {dataHora(pedido.dataAbertura)}
              {pedido.dataFechamento && <> · fechado {dataHora(pedido.dataFechamento)}</>}
              {duracao(pedido.dataAbertura, pedido.dataFechamento) && (
                <> · permanência {duracao(pedido.dataAbertura, pedido.dataFechamento)}</>
              )}
            </p>
          </div>
          {canceladoInteiro && (
            <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold text-rose-800">
              PEDIDO CANCELADO
            </span>
          )}
        </div>

        {/* Totais */}
        <div className="mt-4 flex flex-wrap gap-3">
          {linhaResumo.map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{c.label}</p>
              <p className={`font-mono text-sm ${'destaque' in c && c.destaque ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                {c.valor}
              </p>
            </div>
          ))}
        </div>

        {/* Itens com tempos do KDS */}
        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Qtd</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Lançado</th>
                <th className="px-3 py-2">Pronto</th>
                <th className="px-3 py-2">Entregue</th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    Nenhum item sincronizado ainda.
                  </td>
                </tr>
              )}
              {itens.map((i) => {
                const cancel = i.cancelado
                  ? motivoCancelPorItem.get(i.codigoExterno) ?? null
                  : null;
                const filho = i.codigoPai != null;
                const tProducao = duracao(i.lancadoEm, i.prontoEm);
                const tEntrega = duracao(i.prontoEm, i.entregueEm);
                return (
                  <tr key={i.id} className={`border-t border-slate-100 ${i.cancelado ? 'bg-rose-50/50' : ''}`}>
                    <td className={`px-3 py-1.5 ${filho ? 'pl-7 text-slate-500' : 'text-slate-800'}`}>
                      <span className={i.cancelado ? 'line-through decoration-rose-400' : ''}>
                        {i.nome ?? '(sem nome)'}
                      </span>
                      {i.detalhes && <div className="text-[10px] text-slate-400">{i.detalhes}</div>}
                      {i.cancelado && (
                        <div className="text-[10px] font-medium text-rose-700">
                          cancelado{cancel?.statusItem ? ` (${cancel.statusItem.replace(/_/g, ' ')})` : ''}
                          {cancel?.motivo ? ` — ${cancel.motivo}` : ''}
                          {cancel?.gerente ? ` · autorizou: ${cancel.gerente}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{Number(i.quantidade ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{brl(Number(i.valorTotal ?? 0))}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-500">{hora(i.lancadoEm)}</td>
                    <td className="px-3 py-1.5 font-mono">
                      {i.prontoEm ? (
                        <>
                          {hora(i.prontoEm)}
                          {tProducao && <span className="ml-1 text-[10px] text-emerald-700">({tProducao})</span>}
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {i.entregueEm ? (
                        <>
                          {hora(i.entregueEm)}
                          {tEntrega && <span className="ml-1 text-[10px] text-sky-700">({tEntrega})</span>}
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!temKds && itens.length > 0 && (
            <p className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-400">
              Tempos de pronto/entregue vêm dos toques no KDS da loja — disponíveis a partir da
              publicação desta versão do vendas-local (itens antigos ficam sem).
            </p>
          )}
        </div>

        {/* Cancelamentos do pedido */}
        {cancelamentos.length > 0 && (
          <div className="mt-5 rounded-xl border border-rose-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-rose-800">
              Cancelamentos ({cancelamentos.length})
            </h2>
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1 pr-3">Quando</th>
                  <th className="py-1 pr-3">O quê</th>
                  <th className="py-1 pr-3 text-right">Valor</th>
                  <th className="py-1 pr-3">Situação do item</th>
                  <th className="py-1 pr-3">Motivo</th>
                  <th className="py-1">Autorizou</th>
                </tr>
              </thead>
              <tbody>
                {cancelamentos.map((c, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 font-mono">{dataHora(c.quando)}</td>
                    <td className="py-1.5 pr-3">{c.tipo === 'pedido' ? 'PEDIDO INTEIRO' : c.nome ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">
                      {c.valor != null ? brl(Number(c.valor)) : '—'}
                    </td>
                    <td className="py-1.5 pr-3">{c.statusItem?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{c.motivo ?? '—'}</td>
                    <td className="py-1.5">{c.gerente ?? c.login ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagamentos */}
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Pagamentos {pagamentos.length > 0 && `(${pagamentos.length})`}
          </h2>
          {pagamentos.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Nenhum pagamento sincronizado.</p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1 pr-3">Quando</th>
                  <th className="py-1 pr-3">Forma</th>
                  <th className="py-1 pr-3">Bandeira</th>
                  <th className="py-1 pr-3">NSU</th>
                  <th className="py-1 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {pagamentos.map((p, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 font-mono">{dataHora(p.data)}</td>
                    <td className="py-1.5 pr-3">{p.forma ?? 'sem forma'}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{p.bandeira ?? '—'}</td>
                    <td className="py-1.5 pr-3 font-mono text-slate-500">{p.nsu ?? '—'}</td>
                    <td className="py-1.5 text-right font-mono font-semibold">{brl(Number(p.valor ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
