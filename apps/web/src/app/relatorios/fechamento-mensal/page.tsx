// /relatorios/fechamento-mensal — visualiza snapshots consolidados de
// meses antigos (antes de 2025-10-01). Pra meses recentes, ve via
// /relatorios/dre, /movimento/pedidos, etc — esses ainda tem raw data.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  ano?: string;
  mes?: string;
}

const MESES_LABEL = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export default async function FechamentoMensalPage(props: { searchParams: Promise<SP> }) {
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

  // Lista todos os meses snapshotados pra esta filial
  const meses = await db
    .select({
      ano: schema.fechamentoMensal.ano,
      mes: schema.fechamentoMensal.mes,
      totalVendas: schema.fechamentoMensal.totalVendas,
      qtdPedidos: schema.fechamentoMensal.qtdPedidos,
      ticketMedio: schema.fechamentoMensal.ticketMedio,
      qtdPessoas: schema.fechamentoMensal.qtdPessoas,
      totalDesconto: schema.fechamentoMensal.totalDesconto,
      totalAcrescimo: schema.fechamentoMensal.totalAcrescimo,
      totalServico: schema.fechamentoMensal.totalServico,
      totalPagamentos: schema.fechamentoMensal.totalPagamentos,
    })
    .from(schema.fechamentoMensal)
    .where(eq(schema.fechamentoMensal.filialId, filialSelecionada.id))
    .orderBy(desc(schema.fechamentoMensal.ano), desc(schema.fechamentoMensal.mes));

  // Mes selecionado (default: mais recente)
  const anoSel = sp.ano ? Number(sp.ano) : meses[0]?.ano;
  const mesSel = sp.mes ? Number(sp.mes) : meses[0]?.mes;
  const mesAtual = meses.find((m) => m.ano === anoSel && m.mes === mesSel);

  // Detalhes do mes selecionado
  const formas = mesAtual
    ? await db
        .select()
        .from(schema.fechamentoMensalForma)
        .where(
          and(
            eq(schema.fechamentoMensalForma.filialId, filialSelecionada.id),
            eq(schema.fechamentoMensalForma.ano, anoSel!),
            eq(schema.fechamentoMensalForma.mes, mesSel!),
          ),
        )
        .orderBy(desc(schema.fechamentoMensalForma.valorTotal))
    : [];

  const produtos = mesAtual
    ? await db
        .select()
        .from(schema.fechamentoMensalProduto)
        .where(
          and(
            eq(schema.fechamentoMensalProduto.filialId, filialSelecionada.id),
            eq(schema.fechamentoMensalProduto.ano, anoSel!),
            eq(schema.fechamentoMensalProduto.mes, mesSel!),
          ),
        )
        .orderBy(asc(schema.fechamentoMensalProduto.posicao))
        .limit(50)
    : [];

  const colaboradores = mesAtual
    ? await db
        .select()
        .from(schema.fechamentoMensalColaborador)
        .where(
          and(
            eq(schema.fechamentoMensalColaborador.filialId, filialSelecionada.id),
            eq(schema.fechamentoMensalColaborador.ano, anoSel!),
            eq(schema.fechamentoMensalColaborador.mes, mesSel!),
          ),
        )
        .orderBy(desc(schema.fechamentoMensalColaborador.valorTotal))
        .limit(20)
    : [];

  const totalForma = formas.reduce((s, f) => s + Number(f.valorTotal), 0);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Fechamento mensal</h1>
        <p className="mt-1 text-sm text-slate-600">
          Histórico consolidado por mês. Para dados detalhados (pedido a pedido),
          use as telas de <Link href="/movimento/pedidos" className="underline">Pedidos</Link> ou{' '}
          <Link href="/relatorios/dre" className="underline">DRE</Link> — esses
          mostram os meses recentes com raw data.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/relatorios/fechamento-mensal?filialId=${f.id}`}
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

        {meses.length === 0 ? (
          <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            <p className="font-semibold">Nenhum fechamento gerado ainda</p>
            <p className="mt-2">
              Roda o script{' '}
              <code className="rounded bg-amber-100 px-1.5 py-0.5">
                scripts/sql/2026-05-fechamento-mensal-corte.sql
              </code>{' '}
              no Supabase pra gerar os snapshots.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
            {/* Sidebar com lista de meses */}
            <aside className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Meses ({meses.length})
              </p>
              <ul className="space-y-1">
                {meses.map((m) => {
                  const ativo = m.ano === anoSel && m.mes === mesSel;
                  return (
                    <li key={`${m.ano}-${m.mes}`}>
                      <Link
                        href={`/relatorios/fechamento-mensal?filialId=${filialSelecionada.id}&ano=${m.ano}&mes=${m.mes}`}
                        className={`block rounded-md px-2 py-1.5 text-xs ${
                          ativo
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex justify-between">
                          <span className="font-medium">
                            {MESES_LABEL[m.mes]} {m.ano}
                          </span>
                          <span className={ativo ? 'text-slate-300' : 'text-slate-500'}>
                            {brl(Number(m.totalVendas))}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {/* Conteudo do mes selecionado */}
            <div className="space-y-6">
              {mesAtual ? (
                <>
                  <header>
                    <h2 className="text-xl font-semibold text-slate-900">
                      {MESES_LABEL[mesAtual.mes]} {mesAtual.ano}
                    </h2>
                  </header>

                  {/* KPIs */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <KPI label="Vendas (líquido)" valor={brl(Number(mesAtual.totalVendas))} />
                    <KPI label="Pedidos" valor={int(mesAtual.qtdPedidos)} />
                    <KPI label="Ticket médio" valor={brl(Number(mesAtual.ticketMedio))} />
                    <KPI label="Pessoas" valor={int(mesAtual.qtdPessoas)} />
                    <KPI label="Desconto" valor={brl(Number(mesAtual.totalDesconto))} />
                    <KPI label="Acréscimo" valor={brl(Number(mesAtual.totalAcrescimo))} />
                    <KPI label="Couvert/Serviço" valor={brl(Number(mesAtual.totalServico))} />
                    <KPI label="Pagamentos" valor={brl(Number(mesAtual.totalPagamentos))} />
                  </div>

                  {/* Por forma de pagamento */}
                  <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Por forma de pagamento
                      </h3>
                    </div>
                    {formas.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-slate-500">
                        Sem pagamentos no mês.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-2">Forma</th>
                            <th className="px-4 py-2 text-right">Qtd</th>
                            <th className="px-4 py-2 text-right">Total</th>
                            <th className="px-4 py-2 text-right">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {formas.map((f) => {
                            const pct = totalForma > 0
                              ? ((Number(f.valorTotal) / totalForma) * 100).toFixed(1)
                              : '0.0';
                            return (
                              <tr key={f.id} className="border-t border-slate-100">
                                <td className="px-4 py-2 text-xs text-slate-700">{f.formaPagamento}</td>
                                <td className="px-4 py-2 text-right text-xs text-slate-600">{int(f.qtd)}</td>
                                <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                                  {brl(Number(f.valorTotal))}
                                </td>
                                <td className="px-4 py-2 text-right text-xs text-slate-500">{pct}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Top produtos */}
                  <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Top {produtos.length} produtos do mês
                      </h3>
                    </div>
                    {produtos.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-slate-500">
                        Sem dados de produtos.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-2 w-10">#</th>
                            <th className="px-4 py-2">Produto</th>
                            <th className="px-4 py-2 text-right">Qtd</th>
                            <th className="px-4 py-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {produtos.map((p) => (
                            <tr key={p.id} className="border-t border-slate-100">
                              <td className="px-4 py-2 text-right text-xs text-slate-500">{p.posicao}</td>
                              <td className="px-4 py-2 text-xs text-slate-700">
                                {p.nomeProduto ?? `#${p.codigoProdutoExterno}`}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                                {Number(p.qtd).toFixed(0)}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs font-medium">
                                {brl(Number(p.valorTotal))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Top colaboradores */}
                  {colaboradores.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-200 px-4 py-3">
                        <h3 className="text-sm font-semibold text-slate-900">
                          Vendas por colaborador
                        </h3>
                      </div>
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-2">Colaborador</th>
                            <th className="px-4 py-2 text-right">Pedidos</th>
                            <th className="px-4 py-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {colaboradores.map((c) => (
                            <tr key={c.id} className="border-t border-slate-100">
                              <td className="px-4 py-2 font-mono text-xs text-slate-700">
                                {c.nomeColaborador ?? `#${c.codigoColaborador}`}
                              </td>
                              <td className="px-4 py-2 text-right text-xs text-slate-600">{int(c.qtdPedidos)}</td>
                              <td className="px-4 py-2 text-right font-mono text-xs font-medium">
                                {brl(Number(c.valorTotal))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">Selecione um mês na barra ao lado.</p>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function KPI({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{valor}</p>
    </div>
  );
}
