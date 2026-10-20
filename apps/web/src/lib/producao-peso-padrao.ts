// Peso relativo que uma saída nova de produção recebe quando ninguém digitou:
// o último usado pra esse produto numa OP da casa. Marcou a apara com 0,3
// uma vez → as próximas OPs já vêm com 0,3. Sem histórico → 1.
import { db, schema } from '@concilia/db';
import { and, desc, eq } from 'drizzle-orm';

export async function pesoRelativoPadrao(produtoId: string | null | undefined): Promise<number> {
  if (!produtoId) return 1;
  const [ultimo] = await db
    .select({ peso: schema.ordemProducaoSaida.pesoRelativo })
    .from(schema.ordemProducaoSaida)
    .innerJoin(
      schema.ordemProducao,
      eq(schema.ordemProducao.id, schema.ordemProducaoSaida.ordemProducaoId),
    )
    .where(
      and(
        eq(schema.ordemProducaoSaida.produtoId, produtoId),
        eq(schema.ordemProducaoSaida.tipo, 'PRODUTO'),
      ),
    )
    .orderBy(desc(schema.ordemProducao.criadoEm))
    .limit(1);
  const n = Number(ultimo?.peso ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
