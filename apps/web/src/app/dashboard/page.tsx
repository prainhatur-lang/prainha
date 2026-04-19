import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import type { TaxasFilial, TaxasPorBandeira } from '@concilia/db/schema';
import { and, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { TAXAS_DEFAULT } from '@/lib/conciliacao-banco';
import { brl, formatDateTime, int, relativeTime, statusFromPing } from '@/lib/format';
import { LogoutButton } from './logout-button';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  periodo?: string;
}

type Periodo = '1m' | '3m' | '6m';
const PERIODOS: Periodo[] = ['1m', '3m', '6m'];
const PERIODO_LABEL: Record<Periodo, string> = {
  '1m': '1 mês',
  '3m': '3 meses',
  '6m': '6 meses',
};
const PERIODO_MESES: Record<Periodo, number> = { '1m': 1, '3m': 3, '6m': 6 };

function rangeDoPeriodo(p: Periodo): { dataInicio: string; dataFim: string; dtIni: Date; dtFim: Date } {
  // "Hoje" em BRT (UTC-3)
  const agora = new Date();
  const brNow = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const dataFim = brNow.toISOString().slice(0, 10);
  const brIni = new Date(brNow);
  brIni.setUTCMonth(brIni.getUTCMonth() - PERIODO_MESES[p]);
  const dataInicio = brIni.toISOString().slice(0, 10);
  return {
    dataInicio,
    dataFim,
    dtIni: new Date(dataInicio + 'T00:00:00-03:00'),
    dtFim: new Date(dataFim + 'T23:59:59-03:00'),
  };
}

const FORMAS_OPERADORA = ['Dinheiro', 'Voucher', 'iFood Online'];

export default async function DashboardPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);

  const filialFiltro =
    sp.filialId && filialIds.includes(sp.filialId) ? [sp.filialId] : filialIds;
  const periodo: Periodo = (PERIODOS as readonly string[]).includes(sp.periodo ?? '')
    ? (sp.periodo as Periodo)
    : '1m';
  const range = rangeDoPeriodo(periodo);

  // ---- KPIs + dados de grafico ----
  const dados = filialFiltro.length
    ? await carregarDados(filialFiltro, range.dtIni, range.dtFim)
    : null;

  // ---- Ultimas execucoes por processo ----
  const ultimasExec = filialIds.length
    ? await db
        .select()
        .from(schema.execucaoConciliacao)
        .where(
          and(
            inArray(schema.execucaoConciliacao.filialId, filialFiltro),
            eq(schema.execucaoConciliacao.status, 'OK'),
          ),
        )
        .orderBy(desc(schema.execucaoConciliacao.finalizadoEm))
        .limit(6)
    : [];

  const filialMap = new Map(filiais.map((f) => [f.id, f]));

  const hrefFiltro = (novo: Partial<SP>) => {
    const qs = new URLSearchParams();
    const filialAtual = novo.filialId ?? sp.filialId;
    const periodoAtual = novo.periodo ?? sp.periodo ?? periodo;
    if (filialAtual) qs.set('filialId', filialAtual);
    if (periodoAtual) qs.set('periodo', periodoAtual);
    return `/dashboard?${qs.toString()}`;
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold text-slate-900">
              concilia
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="font-medium text-slate-900">Dashboard</Link>
              <Link href="/sync" className="text-slate-600 hover:text-slate-900">Sincronização</Link>
              <Link href="/upload" className="text-slate-600 hover:text-slate-900">Upload</Link>
              <Link href="/conciliacao" className="text-slate-600 hover:text-slate-900">Conciliação</Link>
              <Link href="/relatorio" className="text-slate-600 hover:text-slate-900">Relatório</Link>
              <Link href="/excecoes" className="text-slate-600 hover:text-slate-900">Exceções</Link>
              <Link href="/fechamento" className="text-slate-600 hover:text-slate-900">Fechamento</Link>
              <Link href="/configuracoes" className="text-slate-600 hover:text-slate-900">Configurações</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Visão geral</h1>
            <p className="mt-1 text-sm text-slate-600">
              Últimos {PERIODO_LABEL[periodo]} — {range.dataInicio.split('-').reverse().join('/')} a{' '}
              {range.dataFim.split('-').reverse().join('/')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Filial:</span>
            <Link
              href={hrefFiltro({ filialId: '' })}
              className={`rounded-md border px-3 py-1 text-xs ${
                !sp.filialId
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Todas
            </Link>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={hrefFiltro({ filialId: f.id })}
                className={`rounded-md border px-3 py-1 text-xs ${
                  sp.filialId === f.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome.replace('Prainha Turismo - ', '')}
              </Link>
            ))}
            <span className="ml-4 text-xs text-slate-500">Período:</span>
            {PERIODOS.map((p) => (
              <Link
                key={p}
                href={hrefFiltro({ periodo: p })}
                className={`rounded-md border px-3 py-1 text-xs ${
                  p === periodo
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {PERIODO_LABEL[p]}
              </Link>
            ))}
          </div>
        </div>

        {!dados ? (
          <p className="mt-10 text-sm text-slate-500">Nenhuma filial acessível.</p>
        ) : (
          <>
            {/* KPIs */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Total vendido"
                value={brl(dados.totalVendas)}
                sub={`${int(dados.qtdVendas)} transações (s/ dinheiro)`}
              />
              <KpiCard
                label="Rastreado na Cielo"
                value={`${dados.pctRastreado.toFixed(1)}%`}
                sub={`${brl(dados.valorRastreado)} de ${brl(dados.totalVendas)}`}
                tone={dados.pctRastreado >= 95 ? 'green' : dados.pctRastreado >= 80 ? 'amber' : 'red'}
              />
              <KpiCard
                label="Recebido no banco"
                value={
                  dados.recebidoPct != null ? `${dados.recebidoPct.toFixed(1)}%` : '—'
                }
                sub={
                  dados.recebidoPct != null
                    ? `${brl(dados.recebidoValor)} caíram`
                    : 'Rode conciliação Banco'
                }
                tone={
                  dados.recebidoPct == null
                    ? 'slate'
                    : dados.recebidoPct >= 95
                      ? 'green'
                      : 'amber'
                }
              />
              <KpiCard
                label="Exceções em aberto"
                value={int(dados.excecoesAbertas.qtd)}
                sub={brl(dados.excecoesAbertas.valor)}
                tone={dados.excecoesAbertas.qtd === 0 ? 'green' : 'amber'}
              />
            </div>

            {/* Composicao por categoria: Pix / Debito / Credito */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {dados.categorias
                .filter((c) => c.categoria !== 'Dinheiro' && c.categoria !== 'Outro')
                .map((c) => (
                  <CategoriaCard key={c.categoria} cat={c} total={dados.totais.bruto} />
                ))}
            </div>

            {/* Totais gerais */}
            <div className="mt-4 flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm shadow-sm">
              <div>
                <span className="text-xs text-slate-500">Bruto total:</span>{' '}
                <span className="font-mono font-semibold text-slate-900">{brl(dados.totais.bruto)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500">Taxas descontadas:</span>{' '}
                <span className="font-mono font-semibold text-rose-700">−{brl(dados.totais.taxa)}</span>
                <span
                  title="Soma real das taxas do arquivo Cielo (coluna 'Valor Taxa/Tarifa'), apenas das vendas que bateram por NSU com o PDV. Vendas ainda não rastreadas não entram neste número."
                  className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-bold text-slate-500"
                >
                  i
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500">Líquido estimado:</span>{' '}
                <span className="font-mono font-semibold text-emerald-700">{brl(dados.totais.liquido)}</span>
              </div>
              {dados.totais.bruto > 0 && (
                <div>
                  <span className="text-xs text-slate-500">Taxa média efetiva:</span>{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {((dados.totais.taxa / dados.totais.bruto) * 100).toFixed(2)}%
                  </span>
                </div>
              )}
            </div>

            {/* Auditoria taxa vs contratado */}
            <Link
              href="/configuracoes"
              className={`mt-4 block rounded-xl border px-5 py-4 text-sm shadow-sm transition hover:shadow-md ${
                Math.abs(dados.taxaVsContratado.diffValor) < 1
                  ? 'border-emerald-200 bg-emerald-50'
                  : dados.taxaVsContratado.diffValor > 0
                    ? 'border-rose-200 bg-rose-50'
                    : 'border-sky-200 bg-sky-50'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                    Taxas vs contratado
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">
                    {Math.abs(dados.taxaVsContratado.diffValor) < 1
                      ? '✓ Cielo cobrou conforme contrato'
                      : dados.taxaVsContratado.diffValor > 0
                        ? '⚠ Cielo cobrou a MAIS'
                        : '↓ Cielo cobrou a MENOS'}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`font-mono text-2xl font-bold ${
                      Math.abs(dados.taxaVsContratado.diffValor) < 1
                        ? 'text-emerald-700'
                        : dados.taxaVsContratado.diffValor > 0
                          ? 'text-rose-700'
                          : 'text-sky-700'
                    }`}
                  >
                    {dados.taxaVsContratado.diffValor > 0 ? '+' : ''}
                    {brl(dados.taxaVsContratado.diffValor)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Sobre {brl(dados.taxaVsContratado.volume)} rastreado
                  </p>
                </div>
              </div>
              {!dados.taxaVsContratado.temConfig && (
                <p className="mt-2 text-[11px] text-amber-700">
                  Taxas contratadas não configuradas — usando defaults. Configure em{' '}
                  <span className="underline">Configurações</span> pra comparação real.
                </p>
              )}
            </Link>

            {/* Chart + forma breakdown */}
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Movimento diário</h2>
                <p className="text-xs text-slate-500">Volume vendido por dia</p>
                <div className="mt-4">
                  <GraficoBarras serie={dados.serie} />
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Por forma de pagamento</h2>
                <p className="text-xs text-slate-500">Todas as formas, incluindo dinheiro</p>
                <div className="mt-4 space-y-2">
                  {dados.porForma.map((f) => {
                    const pct = dados.totais.bruto > 0 ? (f.valor / dados.totais.bruto) * 100 : 0;
                    return (
                      <div key={f.forma} className="text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-700">{f.forma}</span>
                          <span className="font-mono text-slate-900">{brl(f.valor)}</span>
                        </div>
                        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full bg-sky-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {f.taxa > 0 && (
                          <p className="mt-0.5 text-[11px] text-rose-700">
                            Taxa real descontada: <span className="font-mono">−{brl(f.taxa)}</span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {dados.porForma.length === 0 && (
                    <p className="text-xs text-slate-500">Sem dados no período.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Ultimas execucoes + filiais */}
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Últimas execuções</h2>
                {ultimasExec.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">Nenhuma execução ainda.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {ultimasExec.map((e) => {
                      const fil = filialMap.get(e.filialId);
                      const proc = e.processo ?? 'legado';
                      const procLabel =
                        proc === 'OPERADORA'
                          ? 'Operadora'
                          : proc === 'RECEBIVEIS'
                            ? 'Recebíveis'
                            : proc === 'BANCO'
                              ? 'Banco'
                              : proc;
                      return (
                        <li
                          key={e.id}
                          className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-xs"
                        >
                          <div>
                            <p className="font-medium text-slate-800">
                              {procLabel} · {fil?.nome.replace('Prainha Turismo - ', '') ?? ''}
                            </p>
                            <p className="text-slate-500">{formatDateTime(e.finalizadoEm ?? e.iniciadoEm)}</p>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                            {e.status}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Filiais</h2>
                <ul className="mt-3 space-y-2">
                  {filiais.map((f) => {
                    const status = statusFromPing(f.ultimoPing);
                    return (
                      <li
                        key={f.id}
                        className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              status === 'online'
                                ? 'bg-emerald-500'
                                : status === 'warn'
                                  ? 'bg-amber-500'
                                  : status === 'offline'
                                    ? 'bg-rose-500'
                                    : 'bg-slate-400'
                            }`}
                          />
                          <span className="font-medium text-slate-800">
                            {f.nome.replace('Prainha Turismo - ', '')}
                          </span>
                        </div>
                        <span className="text-slate-500">
                          último ping {relativeTime(f.ultimoPing)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// KPI / gráfico
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  sub,
  tone = 'slate',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'slate' | 'green' | 'amber' | 'red';
}) {
  const tones = {
    slate: 'bg-white border-slate-200',
    green: 'bg-emerald-50 border-emerald-200',
    amber: 'bg-amber-50 border-amber-200',
    red: 'bg-rose-50 border-rose-200',
  };
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function CategoriaCard({ cat, total }: { cat: CategoriaStats; total: number }) {
  const cores: Record<string, { bg: string; accent: string; text: string }> = {
    Pix: { bg: 'bg-emerald-50 border-emerald-200', accent: 'bg-emerald-500', text: 'text-emerald-900' },
    Débito: { bg: 'bg-sky-50 border-sky-200', accent: 'bg-sky-500', text: 'text-sky-900' },
    Crédito: { bg: 'bg-violet-50 border-violet-200', accent: 'bg-violet-500', text: 'text-violet-900' },
  };
  const cor = cores[cat.categoria] ?? {
    bg: 'bg-slate-50 border-slate-200',
    accent: 'bg-slate-500',
    text: 'text-slate-900',
  };
  const pctDoTotal = total > 0 ? (cat.valorBruto / total) * 100 : 0;
  const pctConciliado = cat.valorBruto > 0 ? (cat.valorConciliado / cat.valorBruto) * 100 : 0;
  const taxaMediaPct =
    cat.valorBrutoRastreado > 0 ? (cat.valorTaxa / cat.valorBrutoRastreado) * 100 : 0;
  const liquido = cat.valorBruto - cat.valorTaxa;
  const ehDinheiro = cat.categoria === 'Dinheiro';
  return (
    <div className={`rounded-xl border p-5 shadow-sm ${cor.bg}`}>
      <div className="flex items-center justify-between">
        <h3 className={`text-base font-semibold ${cor.text}`}>{cat.categoria}</h3>
        <span className={`text-xs font-medium ${cor.text}`}>{pctDoTotal.toFixed(1)}%</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{brl(cat.valorBruto)}</p>
      <p className="text-[11px] text-slate-500">{int(cat.qtd)} transações</p>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/60">
        <div className={`h-full ${cor.accent}`} style={{ width: `${pctDoTotal}%` }} />
      </div>

      <div className="mt-4 space-y-1 border-t border-white/60 pt-3 text-xs">
        {!ehDinheiro && (
          <>
            <div className="flex justify-between">
              <span className="text-slate-600">Conciliado</span>
              <span
                className={`font-mono font-semibold ${
                  pctConciliado >= 95
                    ? 'text-emerald-700'
                    : pctConciliado >= 80
                      ? 'text-amber-700'
                      : 'text-rose-700'
                }`}
              >
                {pctConciliado.toFixed(1)}%
              </span>
            </div>
            <div className="mb-1 h-1 overflow-hidden rounded-full bg-white/60">
              <div
                className={`h-full ${
                  pctConciliado >= 95
                    ? 'bg-emerald-500'
                    : pctConciliado >= 80
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                }`}
                style={{ width: `${Math.min(100, pctConciliado)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>
                {int(cat.qtdConciliada)} de {int(cat.qtd)} transações
              </span>
              <span>{brl(cat.valorBruto - cat.valorConciliado)} pendente</span>
            </div>
          </>
        )}
        <div className="flex justify-between pt-1">
          <span className="flex items-center gap-1 text-slate-600">
            Taxa real
            <span
              title="% efetivo descontado no arquivo Cielo = soma(valor_taxa) / soma(valor_bruto) das vendas rastreadas."
              className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-slate-300 bg-white/80 text-[9px] font-bold text-slate-500"
            >
              i
            </span>
          </span>
          <span className="font-mono font-medium text-slate-900">
            {taxaMediaPct > 0 ? `${taxaMediaPct.toFixed(2)}%` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-600">Descontado</span>
          <span className="font-mono font-medium text-rose-700">
            {cat.valorTaxa > 0 ? `−${brl(cat.valorTaxa)}` : '—'}
          </span>
        </div>
        <div className="flex justify-between border-t border-white/60 pt-1">
          <span className="text-slate-600">Líquido</span>
          <span className="font-mono font-medium text-emerald-700">{brl(liquido)}</span>
        </div>
      </div>
    </div>
  );
}

function GraficoBarras({ serie }: { serie: Array<{ dia: string; valor: number }> }) {
  if (serie.length === 0 || serie.every((s) => s.valor === 0)) {
    return <p className="text-xs text-slate-500">Sem dados no período.</p>;
  }
  const max = Math.max(...serie.map((s) => s.valor));
  return (
    <div className="flex h-40 items-end gap-0.5 overflow-x-auto">
      {serie.map((s) => {
        const h = max > 0 && s.valor > 0 ? Math.max(4, (s.valor / max) * 100) : 0;
        return (
          <div
            key={s.dia}
            title={`${s.dia.split('-').reverse().join('/')}: ${brl(s.valor)}`}
            style={{ height: `${h}%` }}
            className="min-w-[8px] flex-1 rounded-t bg-sky-500 transition hover:bg-sky-600"
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface CategoriaStats {
  categoria: 'Pix' | 'Crédito' | 'Débito' | 'Dinheiro' | 'Outro';
  valorBruto: number;
  qtd: number;
  /** Valor PDV que bateu com Cielo (usado pra % conciliado). */
  valorConciliado: number;
  qtdConciliada: number;
  /** Valor bruto das vendas Cielo matched (usado pra calcular taxa real). */
  valorBrutoRastreado: number;
  valorTaxa: number; // absoluto (>0)
  qtdRastreada: number;
}

interface DadosDashboard {
  totalVendas: number;
  qtdVendas: number;
  valorRastreado: number;
  pctRastreado: number;
  recebidoPct: number | null;
  recebidoValor: number;
  excecoesAbertas: { qtd: number; valor: number };
  serie: Array<{ dia: string; valor: number }>;
  porForma: Array<{ forma: string; valor: number; taxa: number }>;
  categorias: CategoriaStats[];
  totais: {
    bruto: number;
    taxa: number;
    liquido: number;
  };
  /** Auditoria taxa real × contratado. Positivo = Cielo cobrou a mais. */
  taxaVsContratado: {
    diffValor: number;
    volume: number;
    temConfig: boolean;
  };
}

async function carregarDados(
  filialIds: string[],
  dtIni: Date,
  dtFim: Date,
): Promise<DadosDashboard> {
  const isoIni = dtIni.toISOString().slice(0, 10);
  const isoFim = dtFim.toISOString().slice(0, 10);

  // janela Cielo ±1 dia
  const dtIniCielo = new Date(dtIni);
  dtIniCielo.setDate(dtIniCielo.getDate() - 1);
  const dtFimCielo = new Date(dtFim);
  dtFimCielo.setDate(dtFimCielo.getDate() + 1);
  const isoIniCielo = dtIniCielo.toISOString().slice(0, 10);
  const isoFimCielo = dtFimCielo.toISOString().slice(0, 10);

  const [totalRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
      qtd: sql<number>`COUNT(*)::int`,
      rastreado: sql<string>`
        COALESCE(SUM(CASE WHEN EXISTS (
          SELECT 1 FROM venda_adquirente v
          WHERE v.filial_id = ${schema.pagamento.filialId}
            AND v.nsu = ${schema.pagamento.nsuTransacao}
            AND v.data_venda BETWEEN ${isoIniCielo} AND ${isoFimCielo}
        ) THEN ${schema.pagamento.valor} ELSE 0 END), 0)::text
      `,
    })
    .from(schema.pagamento)
    .where(
      and(
        inArray(schema.pagamento.filialId, filialIds),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
        notInArray(schema.pagamento.formaPagamento, FORMAS_OPERADORA),
        ne(schema.pagamento.formaPagamento, ''),
      ),
    );

  const totalVendas = Number(totalRow?.total ?? 0);
  const qtdVendas = Number(totalRow?.qtd ?? 0);
  const valorRastreado = Number(totalRow?.rastreado ?? 0);
  const pctRastreado = totalVendas > 0 ? (valorRastreado / totalVendas) * 100 : 0;

  // Serie diária
  const serieRows = await db
    .select({
      dia: sql<string>`TO_CHAR(${schema.pagamento.dataPagamento} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`,
      valor: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
    })
    .from(schema.pagamento)
    .where(
      and(
        inArray(schema.pagamento.filialId, filialIds),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const serieMap = new Map(serieRows.map((r) => [r.dia, Number(r.valor)]));
  const serie: Array<{ dia: string; valor: number }> = [];
  const cur = new Date(dtIni);
  while (cur <= dtFim) {
    const iso = cur.toISOString().slice(0, 10);
    serie.push({ dia: iso, valor: serieMap.get(iso) ?? 0 });
    cur.setDate(cur.getDate() + 1);
  }

  // Por forma (todas, incluindo dinheiro — mostrar quadro completo)
  const formaRows = await db
    .select({
      forma: sql<string>`COALESCE(${schema.pagamento.formaPagamento}, 'sem forma')`,
      valor: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
    })
    .from(schema.pagamento)
    .where(
      and(
        inArray(schema.pagamento.filialId, filialIds),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    )
    .groupBy(schema.pagamento.formaPagamento);

  // Taxa real por forma (via match Cielo × PDV)
  const taxaPorForma = new Map<string, number>();
  const taxaRows = await db
    .select({
      forma: sql<string>`COALESCE(${schema.pagamento.formaPagamento}, 'sem forma')`,
      taxa: sql<string>`COALESCE(SUM(ABS(${schema.vendaAdquirente.valorTaxa})), 0)::text`,
    })
    .from(schema.vendaAdquirente)
    .innerJoin(
      schema.pagamento,
      and(
        eq(schema.pagamento.filialId, schema.vendaAdquirente.filialId),
        eq(schema.pagamento.nsuTransacao, schema.vendaAdquirente.nsu),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    )
    .where(
      and(
        inArray(schema.vendaAdquirente.filialId, filialIds),
        eq(schema.vendaAdquirente.adquirente, 'CIELO'),
        gte(schema.vendaAdquirente.dataVenda, isoIniCielo),
        lte(schema.vendaAdquirente.dataVenda, isoFimCielo),
      ),
    )
    .groupBy(schema.pagamento.formaPagamento);
  for (const r of taxaRows) taxaPorForma.set(r.forma, Number(r.taxa));

  const porForma = formaRows
    .map((r) => ({
      forma: r.forma,
      valor: Number(r.valor),
      taxa: taxaPorForma.get(r.forma) ?? 0,
    }))
    .sort((a, b) => b.valor - a.valor);

  // Exceções abertas
  const [excRow] = await db
    .select({
      qtd: sql<number>`COUNT(*)::int`,
      valor: sql<string>`COALESCE(SUM(${schema.excecao.valor}), 0)::text`,
    })
    .from(schema.excecao)
    .where(
      and(
        inArray(schema.excecao.filialId, filialIds),
        isNull(schema.excecao.aceitaEm),
      ),
    );

  // Recebido no banco: pega última execução Banco OK por filial e soma
  let recebidoValor = 0;
  let recebidoTotal = 0;
  for (const fid of filialIds) {
    const [row] = await db
      .select()
      .from(schema.execucaoConciliacao)
      .where(
        and(
          eq(schema.execucaoConciliacao.filialId, fid),
          eq(schema.execucaoConciliacao.processo, 'BANCO'),
          eq(schema.execucaoConciliacao.status, 'OK'),
        ),
      )
      .orderBy(desc(schema.execucaoConciliacao.finalizadoEm))
      .limit(1);
    const r = row?.resumo as { conciliados?: { valor: number }; cieloNaoPago?: { valor: number } } | undefined;
    recebidoValor += Number(r?.conciliados?.valor ?? 0);
    recebidoTotal += Number(r?.conciliados?.valor ?? 0) + Number(r?.cieloNaoPago?.valor ?? 0);
  }
  const recebidoPct = recebidoTotal > 0 ? (recebidoValor / recebidoTotal) * 100 : null;

  // Agregado PDV por categoria (com flag "bateu com Cielo" pra calcular % conciliado)
  const pdvCat = await db
    .select({
      forma: schema.pagamento.formaPagamento,
      valor: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
      qtd: sql<number>`COUNT(*)::int`,
      valorConciliado: sql<string>`
        COALESCE(SUM(CASE WHEN EXISTS (
          SELECT 1 FROM venda_adquirente v
          WHERE v.filial_id = ${schema.pagamento.filialId}
            AND v.nsu = ${schema.pagamento.nsuTransacao}
            AND v.data_venda BETWEEN ${isoIniCielo} AND ${isoFimCielo}
        ) THEN ${schema.pagamento.valor} ELSE 0 END), 0)::text
      `,
      qtdConciliada: sql<number>`
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM venda_adquirente v
          WHERE v.filial_id = ${schema.pagamento.filialId}
            AND v.nsu = ${schema.pagamento.nsuTransacao}
            AND v.data_venda BETWEEN ${isoIniCielo} AND ${isoFimCielo}
        ))::int
      `,
    })
    .from(schema.pagamento)
    .where(
      and(
        inArray(schema.pagamento.filialId, filialIds),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    )
    .groupBy(schema.pagamento.formaPagamento);

  // Agregado Cielo (valor_bruto + valor_taxa) das vendas que bateram NSU
  // com algum pagamento do PDV no periodo
  const cieloCatRows = await db
    .select({
      forma: schema.vendaAdquirente.formaPagamento,
      bruto: sql<string>`COALESCE(SUM(${schema.vendaAdquirente.valorBruto}), 0)::text`,
      taxa: sql<string>`COALESCE(SUM(${schema.vendaAdquirente.valorTaxa}), 0)::text`,
      qtd: sql<number>`COUNT(*)::int`,
    })
    .from(schema.vendaAdquirente)
    .innerJoin(
      schema.pagamento,
      and(
        eq(schema.pagamento.filialId, schema.vendaAdquirente.filialId),
        eq(schema.pagamento.nsuTransacao, schema.vendaAdquirente.nsu),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    )
    .where(
      and(
        inArray(schema.vendaAdquirente.filialId, filialIds),
        gte(schema.vendaAdquirente.dataVenda, isoIniCielo),
        lte(schema.vendaAdquirente.dataVenda, isoFimCielo),
      ),
    )
    .groupBy(schema.vendaAdquirente.formaPagamento);

  function categoriaDe(f: string | null | undefined): CategoriaStats['categoria'] {
    if (!f) return 'Outro';
    const s = f.toLowerCase();
    if (s.includes('pix')) return 'Pix';
    if (s.includes('débito') || s.includes('debito')) return 'Débito';
    if (s.includes('crédito') || s.includes('credito')) return 'Crédito';
    if (s.includes('dinheiro')) return 'Dinheiro';
    return 'Outro';
  }

  const catMap = new Map<CategoriaStats['categoria'], CategoriaStats>();
  const garantir = (c: CategoriaStats['categoria']): CategoriaStats => {
    let x = catMap.get(c);
    if (!x) {
      x = {
        categoria: c,
        valorBruto: 0,
        qtd: 0,
        valorConciliado: 0,
        qtdConciliada: 0,
        valorBrutoRastreado: 0,
        valorTaxa: 0,
        qtdRastreada: 0,
      };
      catMap.set(c, x);
    }
    return x;
  };
  for (const p of pdvCat) {
    const c = garantir(categoriaDe(p.forma));
    c.valorBruto += Number(p.valor);
    c.qtd += Number(p.qtd);
    c.valorConciliado += Number(p.valorConciliado);
    c.qtdConciliada += Number(p.qtdConciliada);
  }
  for (const v of cieloCatRows) {
    const c = garantir(categoriaDe(v.forma));
    c.valorBrutoRastreado += Number(v.bruto);
    c.valorTaxa += Math.abs(Number(v.taxa));
    c.qtdRastreada += Number(v.qtd);
  }

  const ordem: CategoriaStats['categoria'][] = ['Pix', 'Débito', 'Crédito', 'Dinheiro', 'Outro'];
  const categorias = ordem
    .map((c) => catMap.get(c))
    .filter((x): x is CategoriaStats => !!x && (x.valorBruto > 0 || x.valorBrutoRastreado > 0));

  const totaisBruto = categorias.reduce((s, c) => s + c.valorBruto, 0);
  const totaisTaxa = categorias.reduce((s, c) => s + c.valorTaxa, 0);

  // Auditoria taxa real × contratado
  const taxaAuditoria = await computarDiffTaxa(filialIds, dtIni, dtFim);

  return {
    totalVendas,
    qtdVendas,
    valorRastreado,
    pctRastreado,
    recebidoPct,
    recebidoValor,
    excecoesAbertas: {
      qtd: Number(excRow?.qtd ?? 0),
      valor: Number(excRow?.valor ?? 0),
    },
    serie,
    porForma,
    categorias,
    totais: {
      bruto: totaisBruto,
      taxa: totaisTaxa,
      liquido: totaisBruto - totaisTaxa,
    },
    taxaVsContratado: taxaAuditoria,
  };
}

function normalizarBandeira(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function resolverTaxaConfig(
  taxas: TaxasFilial | null,
  ec: string | null,
  forma: string | null,
  bandeira: string | null,
): number {
  const ecConf = taxas?.ecs?.find((e) => e.codigo === ec);
  const base: TaxasPorBandeira = ecConf ?? taxas?.default ?? TAXAS_DEFAULT;
  const f = (forma ?? '').toLowerCase();
  const b = normalizarBandeira(bandeira);
  if (f.includes('pix')) return Number(base.pix ?? TAXAS_DEFAULT.pix);
  if (f.includes('débito') || f.includes('debito')) {
    const map = base.debito ?? TAXAS_DEFAULT.debito;
    return Number(map[b] ?? map['visa'] ?? TAXAS_DEFAULT.debito.visa);
  }
  if (f.includes('crédito') || f.includes('credito')) {
    const map = base.credito_a_vista ?? TAXAS_DEFAULT.credito_a_vista;
    return Number(map[b] ?? map['visa'] ?? TAXAS_DEFAULT.credito_a_vista.visa);
  }
  return 0;
}

async function computarDiffTaxa(
  filialIds: string[],
  dtIni: Date,
  dtFim: Date,
): Promise<{ diffValor: number; volume: number; temConfig: boolean }> {
  // Carrega taxas por filial
  const filiais = await db
    .select({ id: schema.filial.id, taxas: schema.filial.taxas })
    .from(schema.filial)
    .where(inArray(schema.filial.id, filialIds));
  const taxasMap = new Map<string, TaxasFilial | null>(
    filiais.map((f) => [f.id, (f.taxas as TaxasFilial | null) ?? null]),
  );
  const temConfig = filiais.some((f) => f.taxas != null);

  // Agrega vendas rastreadas por (filial, ec, forma, bandeira)
  const rows = await db
    .select({
      filialId: schema.vendaAdquirente.filialId,
      ec: schema.vendaAdquirente.codigoEstabelecimento,
      forma: schema.vendaAdquirente.formaPagamento,
      bandeira: schema.vendaAdquirente.bandeira,
      bruto: sql<string>`COALESCE(SUM(${schema.vendaAdquirente.valorBruto}), 0)::text`,
      taxaTotal: sql<string>`COALESCE(SUM(ABS(${schema.vendaAdquirente.valorTaxa})), 0)::text`,
    })
    .from(schema.vendaAdquirente)
    .innerJoin(
      schema.pagamento,
      and(
        eq(schema.pagamento.filialId, schema.vendaAdquirente.filialId),
        eq(schema.pagamento.nsuTransacao, schema.vendaAdquirente.nsu),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    )
    .where(
      and(
        inArray(schema.vendaAdquirente.filialId, filialIds),
        eq(schema.vendaAdquirente.adquirente, 'CIELO'),
      ),
    )
    .groupBy(
      schema.vendaAdquirente.filialId,
      schema.vendaAdquirente.codigoEstabelecimento,
      schema.vendaAdquirente.formaPagamento,
      schema.vendaAdquirente.bandeira,
    );

  let diffValor = 0;
  let volume = 0;
  for (const r of rows) {
    const bruto = Number(r.bruto);
    const taxaReal = bruto > 0 ? (Number(r.taxaTotal) / bruto) * 100 : 0;
    const taxaConfig = resolverTaxaConfig(
      taxasMap.get(r.filialId) ?? null,
      r.ec,
      r.forma,
      r.bandeira,
    );
    const diff = taxaReal - taxaConfig;
    diffValor += (diff * bruto) / 100;
    volume += bruto;
  }
  return { diffValor: +diffValor.toFixed(2), volume, temConfig };
}
