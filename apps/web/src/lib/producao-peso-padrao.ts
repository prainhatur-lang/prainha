// Peso relativo que uma saída nova de produção recebe quando ninguém digitou:
// 1º o configurado no cadastro do produto (peso_relativo_producao);
// 2º o último usado pra esse produto numa OP (marcou a apara com 0,3 uma
// vez → as próximas já vêm com 0,3); sem nada → 1.
import { db, schema } from '@concilia/db';
import { and, desc, eq } from 'drizzle-orm';

export async function pesoRelativoPadrao(produtoId: string | null | undefined): Promise<number> {
  if (!produtoId) return 1;
  const [cad] = await db
    .select({ peso: schema.produto.pesoRelativoProducao })
    .from(schema.produto)
    .where(eq(schema.produto.id, produtoId))
    .limit(1);
  const pesoCad = Number(cad?.peso ?? NaN);
  if (Number.isFinite(pesoCad) && pesoCad > 0) return pesoCad;
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
