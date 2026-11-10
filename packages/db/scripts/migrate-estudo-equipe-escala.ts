// Estudo de equipe: escala sugerida pela IA (10/11/2026). Três colunas novas em
// rh_estudo_equipe — a escala sugerida (texto), quando e por quem foi gerada.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:estudo-equipe-escala

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE rh_estudo_equipe ADD COLUMN IF NOT EXISTS escala_sugerida text;
    ALTER TABLE rh_estudo_equipe ADD COLUMN IF NOT EXISTS escala_em timestamptz;
    ALTER TABLE rh_estudo_equipe ADD COLUMN IF NOT EXISTS escala_por text;
  `);
  console.log('ok: rh_estudo_equipe.escala_sugerida/escala_em/escala_por');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
