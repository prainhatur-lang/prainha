// Borderô avulso (sem folha semanal e sem quinzena de vale-transporte): quando
// a conta do intermediário é paga, as contas individuais presas nele ficavam
// "em aberto / atrasada" em Contas a pagar pra sempre — o borderô da folha e o
// do VT têm a baixa em lote na tela deles, o avulso não tem tela nenhuma.
// Caso: diária (diferença) do Roberto Fagner, borderô avulso de 11/11/2026 pago
// por Pix pelo sistema. Aqui a individual recebe a baixa do saldo na data em
// que a conta do borderô foi paga. Borderô de folha/VT não entra (continua na
// baixa em lote, como sempre). Idempotente.

import { db, schema } from '@concilia/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { recalcularAgregado } from '@/lib/conta-pagar-baixa';

export async function baixarIndividuaisDeBorderoAvulso(): Promise<{ contaId: string; data: string; valor: number }[]> {
  const pendentes = await db
    .select({
      id: schema.contaPagar.id,
      filialId: schema.contaPagar.filialId,
      valor: schema.contaPagar.valor,
      borderoContaId: schema.bordero.contaPagarId,
    })
    .from(schema.contaPagar)
    .innerJoin(schema.bordero, eq(schema.bordero.id, schema.contaPagar.borderoId))
    .where(
      and(
        eq(schema.bordero.status, 'ATIVO'),
        isNull(schema.bordero.folhaSemanaId),
        isNull(schema.bordero.vtQuinzenaId),
        isNotNull(schema.bordero.contaPagarId),
        isNull(schema.contaPagar.dataPagamento),
        isNull(schema.contaPagar.dataDelete),
      ),
    );
  const feitas: { contaId: string; data: string; valor: number }[] = [];
  for (const c of pendentes) {
    const [b] = await db
      .select({ dataPagamento: schema.contaPagar.dataPagamento, descricao: schema.contaPagar.descricao })
      .from(schema.contaPagar)
      .where(and(eq(schema.contaPagar.id, c.borderoContaId!), isNull(schema.contaPagar.dataDelete)))
      .limit(1);
    if (!b?.dataPagamento) continue; // borderô ainda não foi pago
    const baixas = await db
      .select({ valor: schema.contaPagarBaixa.valor })
      .from(schema.contaPagarBaixa)
      .where(eq(schema.contaPagarBaixa.contaPagarId, c.id));
    const saldo = Math.round((Number(c.valor) - baixas.reduce((s, x) => s + Number(x.valor), 0)) * 100) / 100;
    if (saldo <= 0) continue;
    const data = String(b.dataPagamento).slice(0, 10);
    await db.insert(schema.contaPagarBaixa).values({
      filialId: c.filialId,
      contaPagarId: c.id,
      data,
      valor: saldo.toFixed(2),
      juros: null,
      observacao: `Pago pelo borderô (${b.descricao ?? 'avulso'})`.slice(0, 250),
      criadoPor: null,
    });
    await recalcularAgregado(c.id, Number(c.valor));
    feitas.push({ contaId: c.id, data, valor: saldo });
  }
  return feitas;
}
