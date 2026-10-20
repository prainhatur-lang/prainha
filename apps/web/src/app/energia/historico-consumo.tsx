// Histórico de consumo — lê as leituras de hora em hora (tuya_leitura) e
// mostra, por aparelho, consumo de 24 h e 7 dias, média por dia e quedas de
// energia (contador zerou). Média pela potência serve pra aparelho cujo
// contador não acumula (tomada que manda contador parado).

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

type Linha = {
  dispositivo_id: string;
  nome: string;
  leituras_7d: number;
  primeira: string | null;
  consumo_24h: string | null;
  consumo_7d: string | null;
  horas_7d: number;
  potencia_media_7d: string | null;
  potencia_media_24h: string | null;
  quedas_7d: number;
  ultima_queda: string | null;
  offline_7d: number;
};

const fmt = (n: number, casas = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export async function HistoricoConsumo({ filialId }: { filialId: string }) {
  const linhas = (await db.execute(sql`
    SELECT d.id AS dispositivo_id, d.nome,
      count(l.id)::int AS leituras_7d,
      min(l.lido_em)::text AS primeira,
      sum(l.consumo_kwh) FILTER (WHERE l.lido_em >= now() - interval '24 hours')::text AS consumo_24h,
      sum(l.consumo_kwh)::text AS consumo_7d,
      count(l.consumo_kwh)::int AS horas_7d,
      avg(l.potencia_w)::text AS potencia_media_7d,
      avg(l.potencia_w) FILTER (WHERE l.lido_em >= now() - interval '24 hours')::text AS potencia_media_24h,
      count(*) FILTER (WHERE l.zerou)::int AS quedas_7d,
      max(l.lido_em) FILTER (WHERE l.zerou)::text AS ultima_queda,
      count(*) FILTER (WHERE l.online = false)::int AS offline_7d
    FROM tuya_dispositivo d
    LEFT JOIN tuya_leitura l ON l.dispositivo_id = d.id AND l.lido_em >= now() - interval '7 days'
    WHERE d.filial_id = ${filialId} AND d.ativo = true
      AND d.tipo NOT IN ('sensor_porta', 'sensor_presenca', 'sensor_temperatura')
    GROUP BY d.id, d.nome
    ORDER BY d.nome
  `)) as unknown as Linha[];

  if (linhas.length === 0) return null;
  const semNada = linhas.every((l) => l.leituras_7d === 0);

  return (
    <section className="mx-auto max-w-5xl px-4 pb-10">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-800">Histórico de consumo</h2>
        <p className="mt-1 text-xs text-slate-500">
          Leitura gravada de hora em hora. Quando falta luz o contador do disjuntor zera — o sistema percebe e
          continua somando a partir do zero (conta como queda).
        </p>
        {semNada ? (
          <p className="mt-3 text-sm text-slate-500">Ainda sem leituras — a primeira entra na próxima hora cheia.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-3">Aparelho</th>
                  <th className="py-1 pr-3 text-right">Últimas 24 h</th>
                  <th className="py-1 pr-3 text-right">7 dias</th>
                  <th className="py-1 pr-3 text-right">Média por dia</th>
                  <th className="py-1 pr-3 text-right">Potência média</th>
                  <th className="py-1 pr-3 text-right">Quedas (7 d)</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const c24 = l.consumo_24h != null ? Number(l.consumo_24h) : null;
                  const c7 = l.consumo_7d != null ? Number(l.consumo_7d) : null;
                  const mediaDia = c7 != null && l.horas_7d > 0 ? (c7 / l.horas_7d) * 24 : null;
                  const pot7 = l.potencia_media_7d != null ? Number(l.potencia_media_7d) : null;
                  const pot24 = l.potencia_media_24h != null ? Number(l.potencia_media_24h) : null;
                  // Contador parado com potência medida = contador não serve; estima pela potência.
                  const contadorParado = (c7 ?? 0) === 0 && (pot7 ?? 0) > 5;
                  return (
                    <tr key={l.dispositivo_id} className="border-t border-slate-100">
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        {l.nome}
                        <div className="text-[11px] font-normal text-slate-400">
                          {l.leituras_7d} leitura(s)
                          {l.primeira ? ` desde ${quando(l.primeira)}` : ''}
                          {l.offline_7d > 0 ? ` · ${l.offline_7d} sem resposta` : ''}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {contadorParado
                          ? pot24 != null
                            ? `~${fmt((pot24 * 24) / 1000)} kWh`
                            : '—'
                          : c24 != null
                            ? `${fmt(c24)} kWh`
                            : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {contadorParado ? '—' : c7 != null ? `${fmt(c7)} kWh` : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {contadorParado
                          ? pot7 != null
                            ? `~${fmt((pot7 * 24) / 1000)} kWh`
                            : '—'
                          : mediaDia != null
                            ? `${fmt(mediaDia)} kWh`
                            : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pot7 != null ? `${fmt(pot7, 0)} W` : '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {l.quedas_7d}
                        {l.ultima_queda ? (
                          <div className="text-[11px] text-slate-400">última {quando(l.ultima_queda)}</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-400">
              “~” = estimado pela potência média (o contador desse aparelho não acumula).
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
