// Adiciona reserva.cancel_token (link de cancelamento do cliente). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:reserva-cancel

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { prepare: false });

async function main() {
  process.stdout.write('  ALTER reserva ADD cancel_token... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS cancel_token text`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS reserva_cancel_token_unique
      ON reserva (cancel_token) WHERE cancel_token IS NOT NULL
  `;
  console.log('OK');
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
