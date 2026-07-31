// Adiciona reserva.preferencias (gosto de consumo do cliente).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:reserva-preferencias

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER reserva ADD preferencias... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS preferencias text`;
  console.log('OK');
  await sql.end();
  console.log('Migration reserva-preferencias concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
