// Contas de banco de onde a casa paga (25/11/2026) — lista do seletor
// "De onde saiu o dinheiro?". Junta as contas bancárias cadastradas da casa
// (conta_bancaria) com os cartões de crédito que já tiveram fatura lida
// (cartao_fatura, da organização). O que não estiver na lista entra por
// "Outro banco" (digitado).
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export async function bancosDaCasa(filialId: string): Promise<string[]> {
  const nomes: string[] = [];
  const por = (n: string | null | undefined) => {
    const v = (n ?? '').trim();
    if (v && !nomes.some((x) => x.toLowerCase() === v.toLowerCase())) nomes.push(v);
  };

  const contas = await db
    .select({ banco: schema.contaBancaria.banco })
    .from(schema.contaBancaria)
    .where(eq(schema.contaBancaria.filialId, filialId));
  for (const c of contas) por(c.banco);

  const [f] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (f?.organizacaoId) {
    const cartoes = await db
      .selectDistinct({ banco: schema.cartaoFatura.banco, final: schema.cartaoFatura.cartaoFinal })
      .from(schema.cartaoFatura)
      .where(eq(schema.cartaoFatura.organizacaoId, f.organizacaoId));
    for (const c of cartoes) if (c.banco && c.final) por(`Cartão ${c.banco} final ${c.final}`);
  }
  return nomes;
}
