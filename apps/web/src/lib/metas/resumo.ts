// Resumo leve de metas por competência — usado no card read-only do
// Fechamento de mês (não recalcula progresso ao vivo, só lista o que já
// está gravado; ver /rh/metas/[id] pra progresso ao vivo).

import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export async function metasDaCompetencia(filialId: string, competencia: string) {
  return db
    .select()
    .from(schema.metaEquipe)
    .where(and(eq(schema.metaEquipe.filialId, filialId), eq(schema.metaEquipe.competencia, competencia)));
}
