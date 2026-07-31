// Helpers pra lidar com fechamento de periodo por filial+processo.
import { db, schema } from '@concilia/db';
import { and, eq, gte, lte } from 'drizzle-orm';

/** Retorna Set<'YYYY-MM-DD'> com dias fechados no periodo pra essa filial+processo. */
export async function diasFechados(
  filialId: string,
  processo: 'OPERADORA' | 'RECEBIVEIS' | 'BANCO',
  dataInicio: string,
  dataFim: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ data: schema.fechamentoConciliacao.data })
    .from(schema.fechamentoConciliacao)
    .where(
      and(
        eq(schema.fechamentoConciliacao.filialId, filialId),
        eq(schema.fechamentoConciliacao.processo, processo),
        gte(schema.fechamentoConciliacao.data, dataInicio),
        lte(schema.fechamentoConciliacao.data, dataFim),
      ),
    );
  return new Set(rows.map((r) => r.data));
}
