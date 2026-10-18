// Bloco "Evolução das notas" do painel de avaliações (pedido do dono, 18/10/2026:
// "uma média de evolução das notas — se está diminuindo ou aumentando").
// Por casa:
//   - QR da mesa: média de cada semana (seg–dom, BRT) nas últimas 12 semanas e a
//     comparação das últimas 4 com as 4 de antes;
//   - TripAdvisor: nota e total de hoje contra a leitura de ~30 dias atrás (ou a
//     mais antiga que houver), da tabela tripadvisor_resumo.
// O Google não entra: a política da API veda guardar as avaliações, então não há
// histórico pra comparar.

import { db, schema } from '@concilia/db';
import { and, asc, desc, gte, inArray, lte, sql } from 'drizzle-orm';
import { diasAtrasBr } from '@/lib/datas';

const SEMANAS = 12;
/** diferença de média abaixo disso conta como "estável" */
const LIMIAR = 0.05;
/** mínimo de avaliações em cada lado da comparação */
const MINIMO = 5;

function notaBr(n: number, casas = 2): string {
  return n.toFixed(casas).replace('.', ',');
}

/** 'YYYY-MM-DD' → 'DD/MM' sem passar por Date (não escorrega de dia). */
function ymdDiaMes(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

/** Segunda-feira (YYYY-MM-DD) da semana de um dia YYYY-MM-DD. */
function segundaDe(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = segunda
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function somaDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function corNota(m: number): string {
  if (m >= 4.75) return 'bg-emerald-500';
  if (m >= 4.4) return 'bg-emerald-300';
  if (m >= 4) return 'bg-amber-400';
  return 'bg-rose-400';
}

type Tendencia = { tipo: 'sobe' | 'cai' | 'estavel' | 'pouco'; agora: number | null; antes: number | null; dif: number };

function Seta({ t, rotulo }: { t: Tendencia; rotulo: string }) {
  if (t.tipo === 'pouco') {
    return <span className="text-xs text-slate-500">pouca avaliação pra comparar {rotulo}</span>;
  }
  const estilo =
    t.tipo === 'sobe'
      ? 'bg-emerald-50 text-emerald-800'
      : t.tipo === 'cai'
        ? 'bg-rose-50 text-rose-800'
        : 'bg-slate-100 text-slate-700';
  const texto =
    t.tipo === 'sobe'
      ? `▲ subindo (+${notaBr(t.dif)})`
      : t.tipo === 'cai'
        ? `▼ caindo (${notaBr(t.dif)})`
        : '■ estável';
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${estilo}`}>
      {texto}
      <span className="font-normal"> {rotulo}</span>
    </span>
  );
}

export async function BlocoEvolucao({ filiais }: { filiais: Array<{ id: string; nome: string }> }) {
  const ids = filiais.map((f) => f.id);
  if (ids.length === 0) return null;

  const hoje = diasAtrasBr(0);
  const semanaAtual = segundaDe(hoje);
  const primeiraSemana = somaDias(semanaAtual, -7 * (SEMANAS - 1));
  const semanas = Array.from({ length: SEMANAS }, (_, i) => somaDias(primeiraSemana, 7 * i));

  const A = schema.avaliacao;
  const semanaSql = sql<string>`(date_trunc('week', ${A.criadoEm} AT TIME ZONE 'America/Sao_Paulo'))::date::text`;
  const R = schema.tripadvisorResumo;

  const [porSemana, tripHoje, tripAntes, tripPrimeira] = await Promise.all([
    db
      .select({
        filialId: A.filialId,
        semana: semanaSql,
        n: sql<number>`COUNT(*)::int`,
        soma: sql<number>`SUM(${A.nota})::int`,
      })
      .from(A)
      .where(
        and(
          inArray(A.filialId, ids),
          sql`${A.criadoEm} >= (${primeiraSemana}::date::timestamp AT TIME ZONE 'America/Sao_Paulo')`,
        ),
      )
      .groupBy(A.filialId, semanaSql),
    db
      .selectDistinctOn([R.filialId], { filialId: R.filialId, dia: R.dia, nota: R.nota, total: R.total })
      .from(R)
      .where(inArray(R.filialId, ids))
      .orderBy(R.filialId, desc(R.dia)),
    db
      .selectDistinctOn([R.filialId], { filialId: R.filialId, dia: R.dia, nota: R.nota, total: R.total })
      .from(R)
      .where(and(inArray(R.filialId, ids), lte(R.dia, diasAtrasBr(30))))
      .orderBy(R.filialId, desc(R.dia)),
    db
      .selectDistinctOn([R.filialId], { filialId: R.filialId, dia: R.dia, nota: R.nota, total: R.total })
      .from(R)
      .where(and(inArray(R.filialId, ids), gte(R.dia, diasAtrasBr(400))))
      .orderBy(R.filialId, asc(R.dia)),
  ]);

  const casas = filiais
    .map((f) => {
      const linhas = porSemana.filter((r) => r.filialId === f.id);
      const col = semanas.map((s) => {
        const r = linhas.find((x) => x.semana === s);
        return { semana: s, n: r?.n ?? 0, media: r && r.n > 0 ? r.soma / r.n : null };
      });
      const junta = (xs: typeof col) => {
        const n = xs.reduce((a, x) => a + x.n, 0);
        const soma = xs.reduce((a, x) => a + (x.media ?? 0) * x.n, 0);
        return { n, media: n > 0 ? soma / n : null };
      };
      const ult4 = junta(col.slice(-4));
      const ant4 = junta(col.slice(-8, -4));
      let qr: Tendencia;
      if (ult4.n < MINIMO || ant4.n < MINIMO || ult4.media === null || ant4.media === null) {
        qr = { tipo: 'pouco', agora: ult4.media, antes: ant4.media, dif: 0 };
      } else {
        const dif = ult4.media - ant4.media;
        qr = { tipo: dif > LIMIAR ? 'sobe' : dif < -LIMIAR ? 'cai' : 'estavel', agora: ult4.media, antes: ant4.media, dif };
      }

      const th = tripHoje.find((r) => r.filialId === f.id);
      const base =
        tripAntes.find((r) => r.filialId === f.id) ??
        (() => {
          const p = tripPrimeira.find((r) => r.filialId === f.id);
          return p && th && p.dia < th.dia ? p : undefined;
        })();
      let trip: { nota: number; total: number; base: { dia: string; nota: number | null; total: number } | null; t: Tendencia } | null = null;
      if (th && th.nota !== null && th.total > 0) {
        const nota = Number(th.nota);
        const bNota = base && base.nota !== null ? Number(base.nota) : null;
        const dif = bNota === null ? 0 : nota - bNota;
        trip = {
          nota,
          total: th.total,
          base: base ? { dia: base.dia, nota: bNota, total: base.total } : null,
          t:
            bNota === null
              ? { tipo: 'pouco', agora: nota, antes: null, dif: 0 }
              : { tipo: dif > LIMIAR ? 'sobe' : dif < -LIMIAR ? 'cai' : 'estavel', agora: nota, antes: bNota, dif },
        };
      }
      return { id: f.id, nome: f.nome, col, ult4, ant4, qr, trip };
    })
    .filter((c) => c.col.some((x) => x.n > 0) || c.trip);

  if (casas.length === 0) return null;

  return (
    <>
      <h2 className="mt-10 text-lg font-semibold text-slate-900">Evolução das notas</h2>
      <p className="mt-1 text-xs text-slate-500">
        QR da mesa: média de cada semana (segunda a domingo) e as últimas 4 semanas comparadas com as 4
        de antes. TripAdvisor: nota de hoje contra a de 30 dias atrás. O Google não guarda histórico
        aqui (a política dele não deixa), por isso não entra.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {casas.map((c) => (
          <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-slate-900">{c.nome}</h3>

            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">QR da mesa</p>
              {c.col.some((x) => x.n > 0) ? (
                <>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    {c.ult4.media !== null && (
                      <span className="text-2xl font-bold text-slate-900">{notaBr(c.ult4.media)}</span>
                    )}
                    <Seta
                      t={c.qr}
                      rotulo={c.ant4.media !== null ? `vs ${notaBr(c.ant4.media)} nas 4 semanas antes` : ''}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    últimas 4 semanas · {c.ult4.n} {c.ult4.n === 1 ? 'avaliação' : 'avaliações'}
                  </p>

                  {/* barras: altura = média da semana (escala 1 a 5); número embaixo = quantas */}
                  <div className="mt-3 flex h-24 items-end gap-1">
                    {c.col.map((x) => (
                      <div key={x.semana} className="flex h-full flex-1 flex-col items-center justify-end">
                        {x.media !== null ? (
                          <div
                            className={`w-full rounded-t ${corNota(x.media)}`}
                            style={{ height: `${Math.max(6, ((x.media - 1) / 4) * 100)}%` }}
                            title={`semana de ${ymdDiaMes(x.semana)}: média ${notaBr(x.media)} em ${x.n} ${x.n === 1 ? 'avaliação' : 'avaliações'}`}
                          />
                        ) : (
                          <div className="h-0.5 w-full bg-slate-200" title={`semana de ${ymdDiaMes(x.semana)}: nenhuma`} />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-0.5 flex gap-1">
                    {c.col.map((x) => (
                      <span key={x.semana} className="flex-1 text-center text-[10px] tabular-nums text-slate-400">
                        {x.n || ''}
                      </span>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>{ymdDiaMes(c.col[0]!.semana)}</span>
                    <span>esta semana</span>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Nenhuma avaliação pelo QR nas últimas {SEMANAS} semanas.</p>
              )}
            </div>

            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">TripAdvisor</p>
              {c.trip ? (
                <>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-2xl font-bold text-slate-900">{notaBr(c.trip.nota, 1)}</span>
                    <Seta
                      t={c.trip.t}
                      rotulo={
                        c.trip.base && c.trip.base.nota !== null
                          ? `vs ${notaBr(c.trip.base.nota, 1)} em ${ymdDiaMes(c.trip.base.dia)}`
                          : ''
                      }
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {c.trip.total} avaliações
                    {c.trip.base && c.trip.total !== c.trip.base.total && (
                      <span className={c.trip.total > c.trip.base.total ? 'font-medium text-emerald-700' : 'font-medium text-rose-700'}>
                        {' '}
                        · {c.trip.total > c.trip.base.total ? '+' : ''}
                        {c.trip.total - c.trip.base.total} desde {ymdDiaMes(c.trip.base.dia)}
                      </span>
                    )}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Sem nota lida ainda.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
