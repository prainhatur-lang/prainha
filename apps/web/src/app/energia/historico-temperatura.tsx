// Histórico de temperatura do ambiente — leituras de 15 em 15 minutos
// (tuya_leitura.temperatura_c) dos sensores de temperatura da casa (aparelho
// infravermelho). Gráfico dos últimos 7 dias + mínima/máxima/média por dia.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

type Ponto = { dispositivo_id: string; nome: string; t: number; temp: string | null; umid: string | null };

const TZ = 'America/Sao_Paulo';
const fmt1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const diaBr = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const diaSemana = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'short' }).replace('.', '');
const horaBr = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

const L = 720;
const A = 220;
const M = { esq: 36, dir: 10, topo: 10, base: 24 };

export async function HistoricoTemperatura({ filialId }: { filialId: string }) {
  const sensores = (await db.execute(sql`
    SELECT d.id AS dispositivo_id, d.nome
    FROM tuya_dispositivo d
    WHERE d.filial_id = ${filialId} AND d.ativo = true AND d.tipo = 'sensor_temperatura'
    ORDER BY d.nome
  `)) as unknown as Array<{ dispositivo_id: string; nome: string }>;
  if (sensores.length === 0) return null;

  const pontos = (await db.execute(sql`
    SELECT l.dispositivo_id, d.nome,
      (extract(epoch FROM l.lido_em) * 1000)::float8 AS t,
      l.temperatura_c::text AS temp, l.umidade_pct::text AS umid
    FROM tuya_leitura l
    JOIN tuya_dispositivo d ON d.id = l.dispositivo_id
    WHERE d.filial_id = ${filialId} AND d.ativo = true AND d.tipo = 'sensor_temperatura'
      AND l.lido_em >= now() - interval '7 days' AND l.temperatura_c IS NOT NULL
    ORDER BY l.lido_em
  `)) as unknown as Ponto[];

  return (
    <section className="mx-auto max-w-5xl px-4 pb-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-800">Histórico de temperatura</h2>
        <p className="mt-1 text-xs text-slate-500">Temperatura do ambiente gravada de 15 em 15 minutos — últimos 7 dias.</p>
        {sensores.map((s) => {
          const serie = pontos
            .filter((p) => p.dispositivo_id === s.dispositivo_id)
            .map((p) => ({ t: Number(p.t), temp: Number(p.temp), umid: p.umid != null ? Number(p.umid) : null }));
          if (serie.length === 0) {
            return (
              <p key={s.dispositivo_id} className="mt-3 text-sm text-slate-500">
                {s.nome}: ainda sem leituras — a primeira entra no próximo quarto de hora.
              </p>
            );
          }
          const temps = serie.map((p) => p.temp);
          const min = Math.min(...temps);
          const max = Math.max(...temps);
          const yMin = Math.floor(min - 1);
          const yMax = Math.ceil(max + 1);
          const t0 = serie[0]!.t;
          const t1 = Math.max(serie[serie.length - 1]!.t, t0 + 3600_000);
          const x = (t: number) => M.esq + ((t - t0) / (t1 - t0)) * (L - M.esq - M.dir);
          const y = (v: number) => M.topo + (1 - (v - yMin) / (yMax - yMin)) * (A - M.topo - M.base);
          const linha = serie.map((p) => `${x(p.t).toFixed(1)},${y(p.temp).toFixed(1)}`).join(' ');
          const passo = yMax - yMin > 8 ? 2 : 1;
          const grade: number[] = [];
          for (let v = yMin; v <= yMax; v += passo) grade.push(v);

          // por dia (BRT)
          const dias = new Map<string, { ms: number; temps: number[]; umids: number[] }>();
          for (const p of serie) {
            const k = diaBr(p.t);
            const d = dias.get(k) ?? { ms: p.t, temps: [], umids: [] };
            d.temps.push(p.temp);
            if (p.umid != null) d.umids.push(p.umid);
            dias.set(k, d);
          }
          const marcasDia = [...dias.values()].map((d) => d.ms);
          const ultimo = serie[serie.length - 1]!;
          const h24 = serie.filter((p) => p.t >= ultimo.t - 24 * 3600_000).map((p) => p.temp);

          return (
            <div key={s.dispositivo_id} className="mt-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{s.nome}</p>
                  <p className="text-[11px] text-slate-400">
                    última leitura {diaBr(ultimo.t)} {horaBr(ultimo.t)} · {serie.length} leitura(s)
                  </p>
                </div>
                <div className="flex gap-4 text-right">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Agora</p>
                    <p className="text-xl font-bold tabular-nums text-slate-900">{fmt1(ultimo.temp)} °C</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Mín 24 h</p>
                    <p className="text-xl font-bold tabular-nums text-sky-700">{fmt1(Math.min(...h24))} °C</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Máx 24 h</p>
                    <p className="text-xl font-bold tabular-nums text-rose-600">{fmt1(Math.max(...h24))} °C</p>
                  </div>
                  {ultimo.umid != null ? (
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-400">Umidade</p>
                      <p className="text-xl font-bold tabular-nums text-slate-900">{ultimo.umid.toFixed(0)} %</p>
                    </div>
                  ) : null}
                </div>
              </div>

              <svg viewBox={`0 0 ${L} ${A}`} className="mt-3 w-full" role="img" aria-label={`Temperatura de ${s.nome} nos últimos 7 dias`}>
                {grade.map((v) => (
                  <g key={v}>
                    <line x1={M.esq} x2={L - M.dir} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth={1} />
                    <text x={M.esq - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#94a3b8">
                      {v}°
                    </text>
                  </g>
                ))}
                {marcasDia.map((ms) => (
                  <text key={ms} x={x(ms)} y={A - 6} fontSize={11} fill="#94a3b8">
                    {diaBr(ms)}
                  </text>
                ))}
                {serie.length > 1 ? (
                  <polyline points={linha} fill="none" stroke="#0284c7" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                ) : null}
                {serie.length <= 48
                  ? serie.map((p) => <circle key={p.t} cx={x(p.t)} cy={y(p.temp)} r={2.5} fill="#0284c7" />)
                  : null}
              </svg>

              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="py-1 pr-3">Dia</th>
                      <th className="py-1 pr-3 text-right">Mínima</th>
                      <th className="py-1 pr-3 text-right">Média</th>
                      <th className="py-1 pr-3 text-right">Máxima</th>
                      <th className="py-1 pr-3 text-right">Umidade média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...dias.entries()].reverse().map(([k, d]) => (
                      <tr key={k} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3 text-slate-800">
                          {k} <span className="text-[11px] text-slate-400">{diaSemana(d.ms)}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-sky-700">{fmt1(Math.min(...d.temps))} °C</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {fmt1(d.temps.reduce((a, b) => a + b, 0) / d.temps.length)} °C
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-rose-600">{fmt1(Math.max(...d.temps))} °C</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {d.umids.length > 0 ? `${(d.umids.reduce((a, b) => a + b, 0) / d.umids.length).toFixed(0)} %` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
