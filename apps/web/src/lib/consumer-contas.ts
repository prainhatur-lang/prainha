// Conta a pagar que veio do Consumer (origem CONSUMER): enquanto o Consumer da
// casa manda conta pra nuvem, a baixa é no PDV (o sync sobrescreveria a daqui).
// As 3 casas saíram do Consumer pro banco próprio do vendas-local (o envio de
// contas parou em 20/08 na Mar, 06/09 na Tabuará e 07/09/2026 no Bar) e essas
// contas ficaram congeladas — pagas no Inter e ainda "em aberto". Quando a casa
// passa CONSUMER_PARADO_DIAS sem mandar conta, a baixa delas passa a ser aqui.

import { db, schema } from '@concilia/db';
import { and, eq, inArray, max } from 'drizzle-orm';

export const CONSUMER_PARADO_DIAS = 15;

/** Das casas pedidas, as que pararam de mandar conta do Consumer (baixa da
 *  conta CONSUMER liberada no Concilia). Casa sem conta CONSUMER entra também. */
export async function casasComConsumerParado(filialIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(filialIds)];
  if (!ids.length) return new Set();
  const ultimo = new Map(
    (
      await db
        .select({ filialId: schema.contaPagar.filialId, ultimo: max(schema.contaPagar.sincronizadoEm) })
        .from(schema.contaPagar)
        .where(and(eq(schema.contaPagar.origem, 'CONSUMER'), inArray(schema.contaPagar.filialId, ids)))
        .groupBy(schema.contaPagar.filialId)
    ).map((r) => [r.filialId, r.ultimo]),
  );
  const corte = Date.now() - CONSUMER_PARADO_DIAS * 86_400_000;
  return new Set(
    ids.filter((id) => {
      const u = ultimo.get(id);
      return !u || new Date(u).getTime() < corte;
    }),
  );
}

export async function consumerParado(filialId: string): Promise<boolean> {
  return (await casasComConsumerParado([filialId])).has(filialId);
}

/** Fornecedores com conta do Consumer que entram em Pedidos a pagar por Pix
 *  (dono 28/10/2026: "coloca só essa de maria"). Só eles; o resto do Consumer
 *  fica fora da tela do Pix. Bar: fornecedor 183 "maria mistao( Graziella de
 *  Santana Bonfim)", R$ 500/mês. */
export const FORNECEDORES_CONSUMER_NO_PIX: readonly string[] = ['7f517065-eec0-4bf1-8539-e75dc4690905'];
