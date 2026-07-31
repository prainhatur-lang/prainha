// ALTER fornecedor ADD valor_pedido_minimo (numeric 14,2 nullable).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fornecedor-pedido-minimo

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER fornecedor ADD valor_pedido_minimo... ');
  await sql`
    ALTER TABLE fornecedor
    ADD COLUMN IF NOT EXISTS valor_pedido_minimo numeric(14, 2)
  `;
  console.log('OK');
  console.log('\nMigration concluida.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
