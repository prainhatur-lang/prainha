/**
 * Selfie do ponto pelo celular (25/10/2026): guarda a foto tirada na hora de
 * bater, pro gerente conferir no /rh/ponto. Aditiva e idempotente.
 *
 * Uso: pnpm --filter @concilia/db migrate:ponto-selfie
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE ponto_celular_tentativa ADD COLUMN IF NOT EXISTS selfie bytea`);
  await sql.unsafe(`ALTER TABLE ponto_celular_tentativa ADD COLUMN IF NOT EXISTS selfie_mime varchar(40)`);
  console.log('[ok] selfie do ponto pelo celular pronta');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
