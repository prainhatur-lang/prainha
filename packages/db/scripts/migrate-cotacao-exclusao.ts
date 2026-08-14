// Coluna cotacao_fornecedor.itens_excluidos: itens que o gestor tirou da
// cotação de um fornecedor específico (jsonb array de cotacao_item_id).
// Item excluído some do link do fornecedor e a resposta dele não disputa.
//
// NOTA: o app também cria esta coluna sozinho na primeira exclusão
// (apps/web/src/lib/cotacao-exclusao.ts, garantirColunaExclusao) porque o
// deploy saiu antes desta migration rodar. Rodar aqui é idempotente.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('[1] Adicionando cotacao_fornecedor.itens_excluidos...');
  await sql`
    ALTER TABLE cotacao_fornecedor
    ADD COLUMN IF NOT EXISTS itens_excluidos jsonb NOT NULL DEFAULT '[]'::jsonb
  `;
  console.log('OK');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
