// Adiciona coluna responsavel em ordem_producao.
// Cozinheiro/responsável pelo porcionamento (texto livre).

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('Adicionando ordem_producao.responsavel...');
  await sql`
    ALTER TABLE ordem_producao
    ADD COLUMN IF NOT EXISTS responsavel varchar(100)
  `;
  console.log('OK');

  // Index pra agrupamento rápido por responsavel no relatorio
  await sql`
    CREATE INDEX IF NOT EXISTS idx_op_responsavel
    ON ordem_producao (filial_id, responsavel)
    WHERE responsavel IS NOT NULL
  `;
  console.log('Index OK');

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
