// Lê o 10% (taxa de servico) por dia direto do banco — sum de
// pedido.total_servico agrupado por data_abertura no fuso BRT.

import { db, schema } from '@concilia/db';
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';

/** Retorna { 'YYYY-MM-DD': totalServico } pra cada dia da semana. */
export async function dezPctPorDia(
  filialId: string,
  dataInicio: string, // YYYY-MM-DD (segunda)
  dataFim: string, // YYYY-MM-DD (domingo)
): Promise<Record<string, number>> {
  // data_abertura no fuso BRT (-03). dataInicio 00:00 a (dataFim+1) 00:00
  const inicio = `${dataInicio} 00:00:00-03`;
  const fimExclusivo = somaDia(dataFim, 1) + ' 00:00:00-03';

  const rows = await db
    .select({
      dia: sql<string>`(${schema.pedido.dataAbertura} AT TIME ZONE 'America/Sao_Paulo')::date`,
      totalServico: sql<string>`COALESCE(SUM(${schema.pedido.totalServico}), 0)::text`,
    })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        gte(schema.pedido.dataAbertura, new Date(inicio)),
        lt(schema.pedido.dataAbertura, new Date(fimExclusivo)),
        isNull(schema.pedido.dataDelete),
      ),
    )
    .groupBy(sql`(${schema.pedido.dataAbertura} AT TIME ZONE 'America/Sao_Paulo')::date`);

  const out: Record<string, number> = {};
  for (const r of rows) {
    // dia vem como Date (postgres-js) ou string (drizzle types) — normalizar
    const diaRaw: unknown = r.dia;
    const dia =
      diaRaw instanceof Date
        ? diaRaw.toISOString().slice(0, 10)
        : String(diaRaw).slice(0, 10);
    out[dia] = Number(r.totalServico);
  }
  return out;
}

function somaDia(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
