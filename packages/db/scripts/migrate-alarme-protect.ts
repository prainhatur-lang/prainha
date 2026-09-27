// Alarme do UniFi Protect armado pelo Concilia via servidor da loja: host + chave cifrada.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:alarme-protect

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`ALTER TABLE alarme_gatilho ADD COLUMN IF NOT EXISTS protect_host varchar(100)`;
  await sql`ALTER TABLE alarme_gatilho ADD COLUMN IF NOT EXISTS protect_api_key text`;
  console.log('Pronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
