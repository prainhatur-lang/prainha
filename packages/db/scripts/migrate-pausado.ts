// Adiciona coluna data_pausado em produto.
// Espelha DATAPAUSADO do PRODUTODETALHE do Consumer.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('Adicionando produto.data_pausado...');
  await sql`
    ALTER TABLE produto
    ADD COLUMN IF NOT EXISTS data_pausado timestamptz
  `;
  console.log('OK');

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
