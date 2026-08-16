// Log de consultas do /trabalhe/lookup (rate limit por IP) + RLS.
// Uso: pnpm --filter @concilia/db migrate:trabalhe-log

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  process.stdout.write('CREATE TABLE trabalhe_lookup_log... ');
  await sql`
    CREATE TABLE IF NOT EXISTS trabalhe_lookup_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ip text NOT NULL,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log('OK');
  process.stdout.write('idx ip/hora... ');
  await sql`CREATE INDEX IF NOT EXISTS idx_trabalhe_log_ip ON trabalhe_lookup_log (ip, criado_em)`;
  console.log('OK');
  process.stdout.write('RLS... ');
  await sql`ALTER TABLE trabalhe_lookup_log ENABLE ROW LEVEL SECURITY`;
  console.log('OK');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
