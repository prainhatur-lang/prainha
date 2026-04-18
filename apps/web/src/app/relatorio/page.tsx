import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { LogoutButton } from '../dashboard/logout-button';
import { brl, int } from '@/lib/format';
import { RelatorioForm } from './form';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  dataInicio?: string;
  dataFim?: string;
}

const ADQUIRENTE_CIELO = 'CIELO';

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
function diasAtras(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function RelatorioPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;

  const dataInicio = sp.dataInicio && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataInicio)
    ? sp.dataInicio
    : diasAtras(30);
  const dataFim = sp.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(sp.dataFim)
    ? sp.dataFim
    : hojeISO();

  const dados = filialSelecionada
    ? await carregarDados(filialSelecionada.id, dataInicio, dataFim)
    : null;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold text-slate-900">
              concilia
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/sync" className="text-slate-600 hover:text-slate-900">
                Sincronização
              </Link>
              <Link href="/upload" className="text-slate-600 hover:text-slate-900">
                Upload
              </Link>
              <Link href="/conciliacao" className="text-slate-600 hover:text-slate-900">
                Conciliação
              </Link>
              <Link href="/relatorio" className="font-medium text-slate-900">
                Relatório
              </Link>
              <Link href="/excecoes" className="text-slate-600 hover:text-slate-900">
                Exceções
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Relatório Consolidado</h1>
        <p className="mt-1 text-sm text-slate-600">
          Responde duas perguntas: a venda entrou na Cielo? E o recebimento caiu no banco?
        </p>

        <div className="mt-6">
          <RelatorioForm
            filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
            sp={{ filialId: filialSelecionada?.id, dataInicio, dataFim }}
          />
        </div>

        {!filialSelecionada ? (
          <p className="mt-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
        ) : !dados ? (
          <p className="mt-10 text-sm text-slate-500">Carregando...</p>
        ) : (
          <>
            {/* Hero cards */}
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
              <HeroCard
                titulo="A venda entrou na Cielo?"
                subtitulo={`PDV ${formatarDataBr(dataInicio)} a ${formatarDataBr(dataFim)}`}
                pct={dados.venda.pct}
                totalTxt={`${brl(dados.venda.rastreado)} de ${brl(dados.venda.total)}`}
                detalhe={
                  dados.venda.gap > 0
                    ? `Faltando: ${brl(dados.venda.gap)} (${int(dados.venda.qtdGap)} transações)`
                    : 'Tudo rastreado.'
                }
                cor={dados.venda.pct >= 98 ? 'emerald' : dados.venda.pct >= 90 ? 'amber' : 'rose'}
              />
              <HeroCard
                titulo="O recebimento caiu no banco?"
                subtitulo={dados.banco.temExecucao
                  ? 'Última conciliação Banco'
                  : 'Rode a conciliação Banco primeiro'}
                pct={dados.banco.pct}
                totalTxt={`${brl(dados.banco.caido)} de ${brl(dados.banco.prometido)}`}
                detalhe={
                  !dados.banco.temExecucao
                    ? '—'
                    : dados.banco.pendente > 0
                      ? `Pendente: ${brl(dados.banco.pendente)}`
                      : 'Tudo caiu.'
                }
                cor={dados.banco.pct >= 95 ? 'emerald' : dados.banco.pct >= 80 ? 'amber' : 'rose'}
              />
            </div>

            {/* Quebra por forma de pagamento */}
            <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Quebra por forma de pagamento
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Totais no período. Créditos D+30 aparecem na Agenda mas podem ainda não ter caído no Banco.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5">Forma</th>
                    <th className="px-5 py-2.5 text-right">PDV</th>
                    <th className="px-5 py-2.5 text-right">Cielo Vendas</th>
                    <th className="px-5 py-2.5 text-right">Agenda</th>
                    <th className="px-5 py-2.5 text-right">Rastreado</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.porForma.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-xs text-slate-500">
                        Sem dados para esse período.
                      </td>
                    </tr>
                  ) : (
                    dados.porForma.map((f) => (
                      <tr key={f.forma} className="border-b border-slate-100 last:border-0">
                        <td className="px-5 py-2.5 text-slate-800">{f.forma}</td>
                        <td className="px-5 py-2.5 text-right font-mono text-slate-700">{brl(f.pdv)}</td>
                        <td className="px-5 py-2.5 text-right font-mono text-slate-700">{brl(f.cielo)}</td>
                        <td className="px-5 py-2.5 text-right font-mono text-slate-700">{brl(f.agenda)}</td>
                        <td className="px-5 py-2.5 text-right">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              f.pctCielo >= 98
                                ? 'bg-emerald-100 text-emerald-800'
                                : f.pctCielo >= 90
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {f.pctCielo.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                  {dados.porForma.length > 0 && (
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                      <td className="px-5 py-2.5 text-slate-900">Total</td>
                      <td className="px-5 py-2.5 text-right font-mono">{brl(dados.totais.pdv)}</td>
                      <td className="px-5 py-2.5 text-right font-mono">{brl(dados.totais.cielo)}</td>
                      <td className="px-5 py-2.5 text-right font-mono">{brl(dados.totais.agenda)}</td>
                      <td className="px-5 py-2.5 text-right font-mono text-slate-700">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Ações */}
            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <Link
                href={`/conciliacao/operadora?filialId=${filialSelecionada.id}`}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
              >
                Abrir conciliação Operadora →
              </Link>
              <Link
                href={`/conciliacao/banco?filialId=${filialSelecionada.id}`}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
              >
                Abrir conciliação Banco →
              </Link>
              <Link
                href={`/excecoes?filialId=${filialSelecionada.id}`}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
              >
                Ver exceções abertas →
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function HeroCard({
  titulo,
  subtitulo,
  pct,
  totalTxt,
  detalhe,
  cor,
}: {
  titulo: string;
  subtitulo: string;
  pct: number;
  totalTxt: string;
  detalhe: string;
  cor: 'emerald' | 'amber' | 'rose';
}) {
  const mapa = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
  } as const;
  return (
    <div className={`rounded-xl border p-6 shadow-sm ${mapa[cor]}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{subtitulo}</p>
      <h3 className="mt-1 text-base font-semibold text-slate-900">{titulo}</h3>
      <p className="mt-4 text-5xl font-bold">{pct.toFixed(1)}%</p>
      <p className="mt-1 text-sm text-slate-700">{totalTxt}</p>
      <p className="mt-3 text-xs font-medium text-slate-800">{detalhe}</p>
    </div>
  );
}

function formatarDataBr(iso: string): string {
  return iso.split('-').reverse().join('/');
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface DadosRelatorio {
  venda: {
    total: number;
    rastreado: number;
    gap: number;
    qtdGap: number;
    pct: number;
  };
  banco: {
    prometido: number;
    caido: number;
    pendente: number;
    pct: number;
    temExecucao: boolean;
  };
  porForma: Array<{
    forma: string;
    pdv: number;
    cielo: number;
    agenda: number;
    pctCielo: number;
  }>;
  totais: { pdv: number; cielo: number; agenda: number };
}

async function carregarDados(
  filialId: string,
  dataInicio: string,
  dataFim: string,
): Promise<DadosRelatorio> {
  const dtIni = new Date(dataInicio + 'T00:00:00');
  const dtFim = new Date(dataFim + 'T23:59:59');
  // janela ±1 dia pro cruzamento NSU (virada do dia)
  const dtIniAmp = new Date(dtIni);
  dtIniAmp.setDate(dtIniAmp.getDate() - 1);
  const dtFimAmp = new Date(dtFim);
  dtFimAmp.setDate(dtFimAmp.getDate() + 1);
  const isoIniAmp = dtIniAmp.toISOString().slice(0, 10);
  const isoFimAmp = dtFimAmp.toISOString().slice(0, 10);

  // 1. Total PDV + rastreado (join por NSU com venda_adquirente)
  const [pdvTotais] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
      qtdTotal: sql<number>`COUNT(*)::int`,
      rastreado: sql<string>`
        COALESCE(SUM(CASE WHEN EXISTS (
          SELECT 1 FROM venda_adquirente v
          WHERE v.filial_id = ${schema.pagamento.filialId}
            AND v.adquirente = ${ADQUIRENTE_CIELO}
            AND v.nsu = ${schema.pagamento.nsuTransacao}
            AND v.data_venda BETWEEN ${isoIniAmp} AND ${isoFimAmp}
        ) THEN ${schema.pagamento.valor} ELSE 0 END), 0)::text
      `,
      qtdRastreados: sql<number>`
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM venda_adquirente v
          WHERE v.filial_id = ${schema.pagamento.filialId}
            AND v.adquirente = ${ADQUIRENTE_CIELO}
            AND v.nsu = ${schema.pagamento.nsuTransacao}
            AND v.data_venda BETWEEN ${isoIniAmp} AND ${isoFimAmp}
        ))::int
      `,
    })
    .from(schema.pagamento)
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    );

  const totalPdv = Number(pdvTotais?.total ?? 0);
  const rastreadoPdv = Number(pdvTotais?.rastreado ?? 0);
  const qtdTotal = Number(pdvTotais?.qtdTotal ?? 0);
  const qtdRastreados = Number(pdvTotais?.qtdRastreados ?? 0);

  // 2. Banco: pega resumo da ultima execucao OK do processo BANCO da filial
  const [ultimaBanco] = await db
    .select()
    .from(schema.execucaoConciliacao)
    .where(
      and(
        eq(schema.execucaoConciliacao.filialId, filialId),
        eq(schema.execucaoConciliacao.processo, 'BANCO'),
        eq(schema.execucaoConciliacao.status, 'OK'),
      ),
    )
    .orderBy(desc(schema.execucaoConciliacao.finalizadoEm))
    .limit(1);

  const resumoBanco = ultimaBanco?.resumo as
    | { conciliados?: { valor: number }; cieloNaoPago?: { valor: number } }
    | undefined;

  const caido = Number(resumoBanco?.conciliados?.valor ?? 0);
  const naoPago = Number(resumoBanco?.cieloNaoPago?.valor ?? 0);
  const prometidoTotal = caido + naoPago;

  // 3. Breakdown por forma de pagamento
  const pdvPorForma = await db
    .select({
      forma: sql<string>`COALESCE(${schema.pagamento.formaPagamento}, 'sem forma')`,
      total: sql<string>`COALESCE(SUM(${schema.pagamento.valor}), 0)::text`,
    })
    .from(schema.pagamento)
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        gte(schema.pagamento.dataPagamento, dtIni),
        lte(schema.pagamento.dataPagamento, dtFim),
      ),
    )
    .groupBy(schema.pagamento.formaPagamento);

  const cieloPorForma = await db
    .select({
      forma: sql<string>`COALESCE(${schema.vendaAdquirente.formaPagamento}, 'sem forma')`,
      total: sql<string>`COALESCE(SUM(${schema.vendaAdquirente.valorBruto}), 0)::text`,
    })
    .from(schema.vendaAdquirente)
    .where(
      and(
        eq(schema.vendaAdquirente.filialId, filialId),
        eq(schema.vendaAdquirente.adquirente, ADQUIRENTE_CIELO),
        gte(schema.vendaAdquirente.dataVenda, dataInicio),
        lte(schema.vendaAdquirente.dataVenda, dataFim),
      ),
    )
    .groupBy(schema.vendaAdquirente.formaPagamento);

  const agendaPorForma = await db
    .select({
      forma: sql<string>`COALESCE(${schema.recebivelAdquirente.formaPagamento}, 'sem forma')`,
      total: sql<string>`COALESCE(SUM(${schema.recebivelAdquirente.valorLiquido}), 0)::text`,
    })
    .from(schema.recebivelAdquirente)
    .where(
      and(
        eq(schema.recebivelAdquirente.filialId, filialId),
        eq(schema.recebivelAdquirente.adquirente, ADQUIRENTE_CIELO),
        gte(schema.recebivelAdquirente.dataVenda, dataInicio),
        lte(schema.recebivelAdquirente.dataVenda, dataFim),
      ),
    )
    .groupBy(schema.recebivelAdquirente.formaPagamento);

  // Normaliza: chave unica por forma (trim + title)
  const formaKey = (s: string) => s.trim().toLowerCase();
  const pdvMap = new Map<string, number>();
  for (const r of pdvPorForma) pdvMap.set(formaKey(r.forma), Number(r.total));
  const cieloMap = new Map<string, number>();
  for (const r of cieloPorForma) cieloMap.set(formaKey(r.forma), Number(r.total));
  const agendaMap = new Map<string, number>();
  for (const r of agendaPorForma) agendaMap.set(formaKey(r.forma), Number(r.total));

  const formas = new Set<string>([...pdvMap.keys(), ...cieloMap.keys(), ...agendaMap.keys()]);
  const porForma = [...formas]
    .map((k) => {
      const pdv = pdvMap.get(k) ?? 0;
      const cielo = cieloMap.get(k) ?? 0;
      const agenda = agendaMap.get(k) ?? 0;
      const pctCielo = pdv > 0 ? (cielo / pdv) * 100 : cielo > 0 ? 100 : 0;
      return {
        forma: capitalize(k),
        pdv,
        cielo,
        agenda,
        pctCielo: Math.min(100, pctCielo),
      };
    })
    .filter((f) => f.pdv > 0 || f.cielo > 0 || f.agenda > 0)
    .sort((a, b) => b.pdv - a.pdv);

  const totais = {
    pdv: [...pdvMap.values()].reduce((s, v) => s + v, 0),
    cielo: [...cieloMap.values()].reduce((s, v) => s + v, 0),
    agenda: [...agendaMap.values()].reduce((s, v) => s + v, 0),
  };

  return {
    venda: {
      total: totalPdv,
      rastreado: rastreadoPdv,
      gap: Math.max(0, totalPdv - rastreadoPdv),
      qtdGap: Math.max(0, qtdTotal - qtdRastreados),
      pct: totalPdv > 0 ? (rastreadoPdv / totalPdv) * 100 : 0,
    },
    banco: {
      prometido: prometidoTotal,
      caido,
      pendente: naoPago,
      pct: prometidoTotal > 0 ? (caido / prometidoTotal) * 100 : 0,
      temExecucao: !!ultimaBanco,
    },
    porForma,
    totais,
  };
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
