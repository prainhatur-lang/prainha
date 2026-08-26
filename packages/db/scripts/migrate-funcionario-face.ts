// Ponto por reconhecimento facial: adiciona face_descriptor em funcionario
// (128 floats do face-api.js, nunca a foto em si).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:funcionario-face

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS face_descriptor jsonb`);
  console.log('[ok] funcionario.face_descriptor pronta');
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
