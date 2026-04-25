// Adiciona coluna peso_relativo em ordem_producao_saida.
// Permite rateio por valor relativo dos cortes (lâmina nobre vs aparas).

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('Adicionando ordem_producao_saida.peso_relativo...');
  await sql`
    ALTER TABLE ordem_producao_saida
    ADD COLUMN IF NOT EXISTS peso_relativo numeric(8, 4) NOT NULL DEFAULT 1
  `;
  console.log('OK');

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
