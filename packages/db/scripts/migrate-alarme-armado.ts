// Armar/desarmar gatilho de alarme pelo painel: guarda quem mudou e quando.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:alarme-armado

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`ALTER TABLE alarme_gatilho ADD COLUMN IF NOT EXISTS ativo_alterado_por varchar(200)`;
  await sql`ALTER TABLE alarme_gatilho ADD COLUMN IF NOT EXISTS ativo_alterado_em timestamptz`;
  console.log('Pronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
