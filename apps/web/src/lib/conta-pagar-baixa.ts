// Agregado da conta a pagar a partir das baixas (conta_pagar_baixa). Usado
// pela rota de baixas da conta (/api/financeiro/contas/[id]/baixas) e pela
// baixa pelo Pix do extrato (/api/financeiro/pix-inter).

import { db, schema } from '@concilia/db';
import { asc, eq, sql } from 'drizzle-orm';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/** Recalcula valor_pago/juros_multa/data_pagamento a partir das baixas.
 *  Quitação é pelo PRINCIPAL; valor_pago carrega principal + juros (o que
 *  de fato saiu do bolso), juros_multa acumula só os juros. */
export async function recalcularAgregado(contaId: string, valorConta: number, exec: Exec = db) {
  const baixas = await exec
    .select({
      data: schema.contaPagarBaixa.data,
      valor: schema.contaPagarBaixa.valor,
      juros: schema.contaPagarBaixa.juros,
      desconto: schema.contaPagarBaixa.desconto,
    })
    .from(schema.contaPagarBaixa)
    .where(eq(schema.contaPagarBaixa.contaPagarId, contaId))
    .orderBy(asc(schema.contaPagarBaixa.data));
  const principal = baixas.reduce((s, x) => s + Number(x.valor), 0);
  const juros = baixas.reduce((s, x) => s + Number(x.juros ?? 0), 0);
  // desconto já está dentro do principal (valor), mas não saiu do bolso
  const desconto = baixas.reduce((s, x) => s + Number(x.desconto ?? 0), 0);
  const quitada = principal >= valorConta - 0.005;
  await exec
    .update(schema.contaPagar)
    .set({
      valorPago: principal - desconto + juros > 0 ? (principal - desconto + juros).toFixed(2) : null,
      jurosMulta: juros > 0 ? juros.toFixed(2) : null,
      // descontos = soma das baixas daqui; conta do Consumer sem desconto
      // aqui mantém o que veio do PDV
      descontos:
        desconto > 0
          ? desconto.toFixed(2)
          : sql`CASE WHEN ${schema.contaPagar.origem} = 'CONSUMER' THEN ${schema.contaPagar.descontos} ELSE NULL END`,
      dataPagamento: quitada && baixas.length > 0 ? baixas[baixas.length - 1]!.data : null,
    })
    .where(eq(schema.contaPagar.id, contaId));
  return { total: principal, juros, desconto, quitada };
}
