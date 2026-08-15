// Condição de pagamento do fornecedor (ex: "boleto 21 dias", "à vista no
// pix"). Coluna autocriada em fornecedor (mesma tática de cotacao-exclusao):
// leitura tolera não existir; primeira gravação cria.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export async function garantirColunaCondicao(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS condicao_pagamento varchar(120)`,
  );
}

export async function lerCondicaoPagamento(fornecedorId: string): Promise<string | null> {
  try {
    const rows = (await db.execute(
      sql`SELECT condicao_pagamento FROM fornecedor WHERE id = ${fornecedorId}`,
    )) as unknown as Array<{ condicao_pagamento: string | null }>;
    return rows[0]?.condicao_pagamento ?? null;
  } catch {
    return null;
  }
}

export async function salvarCondicaoPagamento(
  fornecedorId: string,
  condicao: string | null,
): Promise<void> {
  await garantirColunaCondicao();
  await db.execute(
    sql`UPDATE fornecedor SET condicao_pagamento = ${condicao} WHERE id = ${fornecedorId}`,
  );
}
