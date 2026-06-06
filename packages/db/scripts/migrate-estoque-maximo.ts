// Adiciona produto.estoque_maximo (alvo de reposição p/ sugestão de compra).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:estoque-maximo

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER produto ADD estoque_maximo... ');
  await sql`ALTER TABLE produto ADD COLUMN IF NOT EXISTS estoque_maximo numeric(14,3)`;
  console.log('OK');
  await sql.end();
  console.log('Migration estoque-maximo concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
