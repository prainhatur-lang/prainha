// Adiciona token_publico + enviada_em + marcada_pronta_em em ordem_producao.
// Permite gerar link público pra cozinheiro acessar e atualizar OP sem login.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('Adicionando colunas em ordem_producao...');
  await sql`
    ALTER TABLE ordem_producao
    ADD COLUMN IF NOT EXISTS token_publico varchar(64) UNIQUE
  `;
  await sql`
    ALTER TABLE ordem_producao
    ADD COLUMN IF NOT EXISTS enviada_em timestamptz
  `;
  await sql`
    ALTER TABLE ordem_producao
    ADD COLUMN IF NOT EXISTS marcada_pronta_em timestamptz
  `;
  console.log('  OK');

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
