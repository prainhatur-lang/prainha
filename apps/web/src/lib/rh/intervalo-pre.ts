// Quem tem intervalo pré-assinalado no cadastro (dono 07/11/2026): não bate o
// intervalo e o ponto desconta 30 min (ver lib/rh/calcular-ponto.ts).
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';

export async function idsIntervaloPreAssinalado(ids?: string[]): Promise<Set<string>> {
  if (ids && ids.length === 0) return new Set();
  const rows = await db
    .select({ id: schema.funcionario.id })
    .from(schema.funcionario)
    .where(
      ids
        ? and(eq(schema.funcionario.intervaloPreAssinalado, true), inArray(schema.funcionario.id, ids))
        : eq(schema.funcionario.intervaloPreAssinalado, true),
    );
  return new Set(rows.map((r) => r.id));
}
