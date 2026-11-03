// Borderô do vale transporte (03/11/2026): bordero.vt_quinzena_id. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE bordero ADD COLUMN IF NOT EXISTS vt_quinzena_id uuid`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS bordero_vt_idx ON bordero (vt_quinzena_id)`);
  console.log('ok: bordero.vt_quinzena_id');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
