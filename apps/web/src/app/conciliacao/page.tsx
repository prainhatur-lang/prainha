// Visão unificada da conciliação: VENDA (PDV) → CIELO → BANCO numa tela só.
// O que conciliou automático fica agregado; SÓ o que precisa de mão humana
// aparece destacado, com link direto pra tela onde se resolve.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { FiltroPeriodoConciliacao } from '@/components/filtro-periodo-conciliacao';
import { brl, formatDateTime, int } from '@/lib/format';
import { dateToBrYmd, diasAtrasBr, hojeBr } from '@/lib/datas';
import { ConciliarAgora } from './conciliar-agora';

export const dynamic = 'force-dynamic';

const fmtBr = (iso: string) => iso.split('-').reverse().join('/');

interface DetalhesBaixa {
  aceito?: boolean;
  aguardandoCredito?: boolean;
  creditoPrevisto?: string;
}

/** Pra onde cada tipo de exceção manda o usuário resolver. */
const TELA_POR_TIPO: Record<string, { href: string; label: string }> = {
  PDV_SEM_CIELO: { href: '/conciliacao/operadora', label: 'Operadora' },
  CIELO_SEM_PDV: { href: '/conciliacao/operadora', label: 'Operadora' },
  DIVERGENCIA_VALOR_OPERADORA: { href: '/conciliacao/operadora', label: 'Operadora' },
  VENDA_SEM_AGENDA: { href: '/conciliacao/recebiveis', label: 'Recebíveis' },
  AGENDA_SEM_VENDA: { href: '/conciliacao/recebiveis', label: 'Recebíveis' },
  DIVERGENCIA_VALOR_RECEBIVEL: { href: '/conciliacao/recebiveis', label: 'Recebíveis' },
  TARIFA_CIELO: { href: '/conciliacao/recebiveis', label: 'Recebíveis' },
  CIELO_NAO_PAGO: { href: '/conciliacao/banco', label: 'Banco' },
  CREDITO_SEM_CIELO: { href: '/conciliacao/banco', label: 'Banco' },
};

const TITULO_POR_TIPO: Record<string, string> = {
  PDV_SEM_CIELO: 'Venda no PDV sem registro na Cielo',
  CIELO_SEM_PDV: 'Venda na Cielo sem registro no PDV',
  DIVERGENCIA_VALOR_OPERADORA: 'Valor diferente entre PDV e Cielo',
  VENDA_SEM_AGENDA: 'Venda Cielo sem agenda de recebimento',
  AGENDA_SEM_VENDA: 'Agenda Cielo sem venda correspondente',
  DIVERGENCIA_VALOR_RECEBIVEL: 'Valor diferente entre venda e agenda',
  TARIFA_CIELO: 'Tarifas e ajustes da Cielo',
  CIELO_NAO_PAGO: 'Previsto pela Cielo, não caiu no banco',
  CREDITO_SEM_CIELO: 'Crédito no banco sem origem identificada',
};

export default async function ConciliacaoPage(props: {
  searchParams: Promise<{ filialId?: string; dataInicio?: string; dataFim?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const filial = await escolherFilial(filiais, sp.filialId);

  const filtroExplicito = !!(sp.dataInicio && sp.dataFim);
  const dataFim = sp.dataFim ?? hojeBr();
  const dataInicio = sp.dataInicio ?? diasAtrasBr(7);
  const dtIni = new Date(dataInicio + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');

  // ---------- carga ----------
  const [baixas, vendasCielo, recebiveis, creditosBanco, excecoesAbertas, sugestoes, diretos, execucoes] =
    filial
      ? await Promise.all([
          // 1. estado da cadeia por pagamento (materializado pela conciliação automática)
          db
            .select({
              etapa: schema.conciliacaoPagamento.etapa,
              detalhes: schema.conciliacaoPagamento.detalhes,
              valor: schema.pagamento.valor,
              dataPagamento: schema.pagamento.dataPagamento,
            })
            .from(schema.conciliacaoPagamento)
            .innerJoin(
              schema.pagamento,
              eq(schema.pagamento.id, schema.conciliacaoPagamento.pagamentoId),
            )
            .where(
              and(
                eq(schema.conciliacaoPagamento.filialId, filial.id),
                gte(schema.pagamento.dataPagamento, dtIni),
                lte(schema.pagamento.dataPagamento, dtFim),
              ),
            ),
          // 2. vendas Cielo capturadas no período
          db
            .select({
              dataVenda: schema.vendaAdquirente.dataVenda,
              valorBruto: schema.vendaAdquirente.valorBruto,
            })
            .from(schema.vendaAdquirente)
            .where(
              and(
                eq(schema.vendaAdquirente.filialId, filial.id),
                eq(schema.vendaAdquirente.adquirente, 'CIELO'),
                gte(schema.vendaAdquirente.dataVenda, dataInicio),
                lte(schema.vendaAdquirente.dataVenda, dataFim),
              ),
            ),
          // 3. agenda Cielo paga no período (líquido)
          db
            .select({
              dataPagamento: schema.recebivelAdquirente.dataPagamento,
              valorLiquido: schema.recebivelAdquirente.valorLiquido,
            })
            .from(schema.recebivelAdquirente)
            .where(
              and(
                eq(schema.recebivelAdquirente.filialId, filial.id),
                eq(schema.recebivelAdquirente.adquirente, 'CIELO'),
                gte(schema.recebivelAdquirente.dataPagamento, dataInicio),
                lte(schema.recebivelAdquirente.dataPagamento, dataFim),
              ),
            ),
          // 4. créditos no banco no período
          db
            .select({
              dataMovimento: schema.lancamentoBanco.dataMovimento,
              valor: schema.lancamentoBanco.valor,
            })
            .from(schema.lancamentoBanco)
            .where(
              and(
                eq(schema.lancamentoBanco.filialId, filial.id),
                eq(schema.lancamentoBanco.tipo, 'C'),
                gte(schema.lancamentoBanco.dataMovimento, dataInicio),
                lte(schema.lancamentoBanco.dataMovimento, dataFim),
              ),
            ),
          // 5. TODAS as exceções em aberto da filial (inbox — pendência velha é
          //    a mais importante, então não filtra por período)
          db
            .select({
              id: schema.excecao.id,
              tipo: schema.excecao.tipo,
              severidade: schema.excecao.severidade,
              descricao: schema.excecao.descricao,
              valor: schema.excecao.valor,
              detectadoEm: schema.excecao.detectadoEm,
            })
            .from(schema.excecao)
            .where(and(eq(schema.excecao.filialId, filial.id), isNull(schema.excecao.aceitaEm)))
            .orderBy(desc(schema.excecao.detectadoEm))
            .limit(500),
          // 6. sugestões cross-route abertas
          db
            .select({ id: schema.sugestaoCrossRoute.id })
            .from(schema.sugestaoCrossRoute)
            .where(
              and(
                eq(schema.sugestaoCrossRoute.filialId, filial.id),
                isNull(schema.sugestaoCrossRoute.aceitoEm),
                isNull(schema.sugestaoCrossRoute.rejeitadoEm),
              ),
            ),
          // 7. Pix/TED direto no banco conciliado (fluxo sem Cielo)
          db
            .select({ valor: schema.pagamento.valor })
            .from(schema.matchPdvBanco)
            .innerJoin(schema.pagamento, eq(schema.pagamento.id, schema.matchPdvBanco.pagamentoId))
            .where(
              and(
                eq(schema.matchPdvBanco.filialId, filial.id),
                gte(schema.pagamento.dataPagamento, dtIni),
                lte(schema.pagamento.dataPagamento, dtFim),
              ),
            ),
          // 8. última execução automática
          db
            .select({
              processo: schema.execucaoConciliacao.processo,
              iniciadoEm: schema.execucaoConciliacao.iniciadoEm,
              status: schema.execucaoConciliacao.status,
            })
            .from(schema.execucaoConciliacao)
            .where(eq(schema.execucaoConciliacao.filialId, filial.id))
            .orderBy(desc(schema.execucaoConciliacao.iniciadoEm))
            .limit(3),
        ])
      : [[], [], [], [], [], [], [], []];

  // ---------- agregação ----------
  const soma = (arr: Array<{ valor?: unknown; valorBruto?: unknown; valorLiquido?: unknown }>, k: 'valor' | 'valorBruto' | 'valorLiquido') =>
    arr.reduce((s, x) => s + Number(x[k] ?? 0), 0);

  const agg = {
    pdv: { qtd: baixas.length, valor: soma(baixas, 'valor') },
    completos: { qtd: 0, valor: 0 },
    aguardando: { qtd: 0, valor: 0 },
    aceitos: { qtd: 0, valor: 0 },
    pendentes: { qtd: 0, valor: 0 },
  };
  for (const b of baixas) {
    const det = (b.detalhes ?? {}) as DetalhesBaixa;
    const v = Number(b.valor);
    if (b.etapa === 'COMPLETO') {
      agg.completos.qtd++;
      agg.completos.valor += v;
    } else if (det.aguardandoCredito) {
      agg.aguardando.qtd++;
      agg.aguardando.valor += v;
    } else if (det.aceito) {
      agg.aceitos.qtd++;
      agg.aceitos.valor += v;
    } else {
      agg.pendentes.qtd++;
      agg.pendentes.valor += v;
    }
  }

  const cieloBruto = soma(vendasCielo, 'valorBruto');
  const cieloLiquidoPago = recebiveis.filter((r) => Number(r.valorLiquido) > 0);
  const cieloDescontos = recebiveis.filter((r) => Number(r.valorLiquido) < 0);
  const bancoCreditado = soma(creditosBanco, 'valor');
  const diretoValor = soma(diretos, 'valor');

  // exceções agrupadas por tipo (inbox)
  const excPorTipo = new Map<string, { qtd: number; valor: number; amostra: typeof excecoesAbertas }>();
  for (const e of excecoesAbertas) {
    const g = excPorTipo.get(e.tipo) ?? { qtd: 0, valor: 0, amostra: [] };
    g.qtd++;
    g.valor += Number(e.valor ?? 0);
    if (g.amostra.length < 4) g.amostra.push(e);
    excPorTipo.set(e.tipo, g);
  }
  const tarifas = excPorTipo.get('TARIFA_CIELO');
  excPorTipo.delete('TARIFA_CIELO');
  const totalPendencias = [...excPorTipo.values()].reduce((s, g) => s + g.qtd, 0) + sugestoes.length;

  // por dia
  const dias = new Map<
    string,
    { pdv: number; cielo: number; recebido: number; banco: number; pend: number; total: number; ok: number }
  >();
  const diaVazio = () => ({ pdv: 0, cielo: 0, recebido: 0, banco: 0, pend: 0, total: 0, ok: 0 });
  const addDia = (iso: string) => {
    const d = dias.get(iso) ?? diaVazio();
    dias.set(iso, d);
    return d;
  };
  for (const b of baixas) {
    if (!b.dataPagamento) continue;
    const det = (b.detalhes ?? {}) as DetalhesBaixa;
    const d = addDia(dateToBrYmd(b.dataPagamento));
    d.pdv += Number(b.valor);
    d.total++;
    if (b.etapa === 'COMPLETO' || det.aguardandoCredito || det.aceito) d.ok++;
    else d.pend++;
  }
  for (const v of vendasCielo) addDia(v.dataVenda).cielo += Number(v.valorBruto);
  for (const r of cieloLiquidoPago) addDia(r.dataPagamento).recebido += Number(r.valorLiquido);
  for (const c of creditosBanco) addDia(c.dataMovimento).banco += Number(c.valor);
  const diasOrdenados = [...dias.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const qs = (extra?: string) =>
    `?filialId=${filial?.id ?? ''}${filtroExplicito ? `&dataInicio=${dataInicio}&dataFim=${dataFim}` : ''}${extra ?? ''}`;

  const ultimaExec = execucoes[0] ?? null;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Conciliação</h1>
            <p className="mt-1 text-sm text-slate-600">
              Venda → Cielo → Banco numa tela só. O automático roda 2× ao dia
              {ultimaExec &&
                ` — última rodada ${formatDateTime(ultimaExec.iniciadoEm)} (${ultimaExec.status})`}
              . Só o que está em <span className="font-medium text-amber-700">Pendências</span> precisa
              de você.
            </p>
          </div>
          {filial && (
            <ConciliarAgora filialId={filial.id} dataInicio={dataInicio} dataFim={dataFim} />
          )}
        </div>

        {/* filiais */}
        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/conciliacao?filialId=${f.id}`}
                className={`rounded-full px-3 py-1 text-sm ${
                  f.id === filial?.id
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {filial && (
          <div className="mt-4">
            <FiltroPeriodoConciliacao
              basePath="/conciliacao"
              filialId={filial.id}
              dataInicio={dataInicio}
              dataFim={dataFim}
              filtroExplicito={filtroExplicito}
              ultimaInicio={dataInicio}
              ultimaFim={dataFim}
              hintLabel="Período em exibição"
            />
          </div>
        )}

        {/* ---------- fluxo VENDA → CIELO → BANCO ---------- */}
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="relative rounded-xl border border-sky-200 bg-sky-50 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
              1 · Venda (PDV)
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{brl(agg.pdv.valor)}</p>
            <p className="mt-1 text-xs text-slate-600">
              {int(agg.pdv.qtd)} pagamentos em cartão/Pix maquininha
              {diretoValor > 0 && (
                <>
                  {' '}
                  · +{brl(diretoValor)} Pix direto{' '}
                  <Link href={`/conciliacao/pdv-banco-direto${qs()}`} className="underline">
                    conciliado no banco
                  </Link>
                </>
              )}
            </p>
            <span className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-2xl text-slate-400 md:block">
              →
            </span>
          </div>
          <div className="relative rounded-xl border border-violet-200 bg-violet-50 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">
              2 · Cielo
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{brl(cieloBruto)}</p>
            <p className="mt-1 text-xs text-slate-600">
              {int(vendasCielo.length)} vendas capturadas · recebido líquido{' '}
              {brl(soma(cieloLiquidoPago, 'valorLiquido'))}
              {cieloDescontos.length > 0 && ` · tarifas ${brl(soma(cieloDescontos, 'valorLiquido'))}`}
            </p>
            <span className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-2xl text-slate-400 md:block">
              →
            </span>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              3 · Banco (Inter)
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{brl(bancoCreditado)}</p>
            <p className="mt-1 text-xs text-slate-600">
              {int(creditosBanco.length)} créditos no extrato do período
            </p>
          </div>
        </div>

        {/* ---------- status da cadeia ---------- */}
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-emerald-200 bg-white p-4">
            <p className="text-xs text-slate-500">✓ Conciliado ponta a ponta</p>
            <p className="mt-1 text-lg font-bold text-emerald-700">
              {brl(agg.completos.valor)}{' '}
              <span className="text-xs font-normal text-slate-500">({int(agg.completos.qtd)})</span>
            </p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-white p-4">
            <p className="text-xs text-slate-500">⏳ A receber (crédito futuro)</p>
            <p className="mt-1 text-lg font-bold text-sky-700">
              {brl(agg.aguardando.valor)}{' '}
              <span className="text-xs font-normal text-slate-500">({int(agg.aguardando.qtd)})</span>
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">✋ Aceito com motivo</p>
            <p className="mt-1 text-lg font-bold text-slate-700">
              {brl(agg.aceitos.valor)}{' '}
              <span className="text-xs font-normal text-slate-500">({int(agg.aceitos.qtd)})</span>
            </p>
          </div>
          <div
            className={`rounded-xl border p-4 ${
              agg.pendentes.qtd > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
            }`}
          >
            <p className="text-xs text-slate-500">⚠ Pendente no período</p>
            <p className="mt-1 text-lg font-bold text-amber-700">
              {brl(agg.pendentes.valor)}{' '}
              <span className="text-xs font-normal text-slate-500">({int(agg.pendentes.qtd)})</span>
            </p>
          </div>
        </div>

        {/* ---------- PENDÊNCIAS (inbox — tudo que precisa de gente) ---------- */}
        <div className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Pendências pra resolver{' '}
              {totalPendencias > 0 && (
                <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-800">
                  {int(totalPendencias)}
                </span>
              )}
            </h2>
            <Link href={`/excecoes${qs()}`} className="text-sm text-slate-500 hover:text-slate-800">
              ver todas as exceções →
            </Link>
          </div>

          {totalPendencias === 0 ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
              <p className="text-lg font-medium text-emerald-800">✓ Nada pendente</p>
              <p className="mt-1 text-sm text-emerald-700">
                Tudo que entrou conciliou sozinho ou já foi tratado.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {[...excPorTipo.entries()]
                .sort((a, b) => b[1].valor - a[1].valor)
                .map(([tipo, g]) => {
                  const tela = TELA_POR_TIPO[tipo] ?? { href: '/excecoes', label: 'Exceções' };
                  return (
                    <div
                      key={tipo}
                      className="flex flex-col rounded-xl border border-amber-200 bg-white shadow-sm"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {TITULO_POR_TIPO[tipo] ?? tipo}
                          </p>
                          <p className="text-xs text-slate-500">
                            {int(g.qtd)} item(ns) · {brl(g.valor)}
                          </p>
                        </div>
                        <Link
                          href={`${tela.href}${qs()}`}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          Resolver em {tela.label} →
                        </Link>
                      </div>
                      <ul className="divide-y divide-slate-50 px-4 py-2">
                        {g.amostra.map((e) => (
                          <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-600" title={e.descricao}>
                              {e.descricao}
                            </span>
                            <span className="shrink-0 font-mono text-xs text-slate-700">
                              {e.valor != null ? brl(Number(e.valor)) : '—'}
                            </span>
                          </li>
                        ))}
                        {g.qtd > g.amostra.length && (
                          <li className="py-2 text-xs text-slate-400">
                            + {int(g.qtd - g.amostra.length)} outros…
                          </li>
                        )}
                      </ul>
                    </div>
                  );
                })}

              {sugestoes.length > 0 && (
                <div className="flex flex-col justify-between rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Canal provavelmente errado no PDV
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {int(sugestoes.length)} sugestão(ões) de par entre fluxos (ex.: garçom marcou
                      Pix Online mas caiu direto no banco). Um clique pra aceitar.
                    </p>
                  </div>
                  <Link
                    href={`/conciliacao/cross-route-sugestoes${qs()}`}
                    className="mt-3 self-start rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                  >
                    Revisar sugestões →
                  </Link>
                </div>
              )}
            </div>
          )}

          {tarifas && (
            <p className="mt-3 text-xs text-slate-500">
              ℹ️ {int(tarifas.qtd)} tarifa(s)/ajuste(s) da Cielo somando {brl(tarifas.valor)} no
              aguardo de reconhecimento —{' '}
              <Link href={`/conciliacao/recebiveis${qs()}`} className="underline">
                revisar
              </Link>
              .
            </p>
          )}
        </div>

        {/* ---------- por dia ---------- */}
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900">Dia a dia</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Dia</th>
                  <th className="px-4 py-3 text-right">Venda (PDV)</th>
                  <th className="px-4 py-3 text-right">Cielo capturado</th>
                  <th className="px-4 py-3 text-right">Cielo pagou (líq.)</th>
                  <th className="px-4 py-3 text-right">Caiu no banco</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {diasOrdenados.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">
                      Sem movimento no período — rode “Conciliar agora” ou ajuste o filtro.
                    </td>
                  </tr>
                )}
                {diasOrdenados.map(([dia, d]) => (
                  <tr key={dia} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{fmtBr(dia)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{d.pdv ? brl(d.pdv) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{d.cielo ? brl(d.cielo) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {d.recebido ? brl(d.recebido) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{d.banco ? brl(d.banco) : '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      {d.total === 0 ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : d.pend === 0 ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          ✓ {d.ok}/{d.total}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          {d.pend} pendente(s)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            “Venda (PDV)” considera só o fluxo maquininha (cartão/Pix Cielo). Crédito parcelado e
            vendas recentes aparecem como “A receber” até o crédito cair — isso não é pendência.
          </p>
        </div>

        {/* ---------- atalhos pros processos ---------- */}
        <div className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            {
              href: '/conciliacao/operadora',
              titulo: 'Operadora',
              desc: 'PDV × Vendas Cielo — resolver NSU, valor e forma.',
              cor: 'border-sky-200 bg-sky-50',
            },
            {
              href: '/conciliacao/recebiveis',
              titulo: 'Recebíveis',
              desc: 'Vendas Cielo × Agenda — estornos, tarifas e agenda.',
              cor: 'border-violet-200 bg-violet-50',
            },
            {
              href: '/conciliacao/banco',
              titulo: 'Banco',
              desc: 'Agenda × Extrato Inter — créditos e repasses.',
              cor: 'border-emerald-200 bg-emerald-50',
            },
          ].map((c) => (
            <Link
              key={c.href}
              href={`${c.href}${qs()}`}
              className={`rounded-xl border p-4 shadow-sm transition hover:shadow-md ${c.cor}`}
            >
              <p className="text-sm font-semibold text-slate-900">{c.titulo}</p>
              <p className="mt-1 text-xs text-slate-600">{c.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
