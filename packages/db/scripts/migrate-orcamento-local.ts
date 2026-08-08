// Adiciona a coluna local (ambiente do evento, ex: "Terraço") em
// orcamento_evento. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:orcamento-local

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER TABLE orcamento_evento ADD local... ');
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS local varchar(100)`;
  console.log('OK');
  await sql.end();
  console.log('Migration orcamento-local concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
