// Conferência de recebimento NA NOTA FISCAL: quem recebe a mercadoria confere
// com a nota na mão — nota diz X, chegou Y. Diferença = cobrado e não
// entregue (caso real: Fasouto cobrou 1 item que não veio na caixa).
//
// Colunas criadas sob demanda (mesma tática de cotacao-exclusao): leituras
// toleram não existir; a primeira conferência cria.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export interface ConferenciaNota {
  /** item id -> quantidade que chegou de fato */
  porItem: Map<string, number>;
  obs: string | null;
  conferidaEm: string | null;
}

export async function garantirColunasConferencia(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE nota_compra_item ADD COLUMN IF NOT EXISTS qtd_recebida numeric(14,4)`,
  );
  await db.execute(
    sql`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS conferencia_obs text`,
  );
  await db.execute(
    sql`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS conferida_em timestamptz`,
  );
}

export async function lerConferenciaNota(notaId: string): Promise<ConferenciaNota> {
  const vazio: ConferenciaNota = { porItem: new Map(), obs: null, conferidaEm: null };
  try {
    const itens = (await db.execute(
      sql`SELECT id, qtd_recebida FROM nota_compra_item WHERE nota_compra_id = ${notaId} AND qtd_recebida IS NOT NULL`,
    )) as unknown as Array<{ id: string; qtd_recebida: string }>;
    const [cab] = (await db.execute(
      sql`SELECT conferencia_obs, conferida_em::text AS conferida_em FROM nota_compra WHERE id = ${notaId}`,
    )) as unknown as Array<{ conferencia_obs: string | null; conferida_em: string | null }>;
    return {
      porItem: new Map(itens.map((i) => [i.id, Number(i.qtd_recebida)])),
      obs: cab?.conferencia_obs ?? null,
      conferidaEm: cab?.conferida_em ?? null,
    };
  } catch {
    return vazio; // colunas ainda não existem
  }
}

export async function gravarConferenciaNota(
  notaId: string,
  itens: Array<{ itemId: string; qtdRecebida: number }>,
  obs: string | null,
): Promise<void> {
  await garantirColunasConferencia();
  for (const i of itens) {
    if (!Number.isFinite(i.qtdRecebida) || i.qtdRecebida < 0) continue;
    await db.execute(
      sql`UPDATE nota_compra_item SET qtd_recebida = ${i.qtdRecebida}
          WHERE id = ${i.itemId} AND nota_compra_id = ${notaId}`,
    );
  }
  await db.execute(
    sql`UPDATE nota_compra SET conferencia_obs = ${obs}, conferida_em = now() WHERE id = ${notaId}`,
  );
}
