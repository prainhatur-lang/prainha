// Fila de aprovação do /marketing: o Claude monta o post, o dono aprova ou
// recusa, e o sistema publica. Pedido do dono 25/10/2026. Só colunas novas.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:marketing-fila

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE marketing_post
      ADD COLUMN IF NOT EXISTS origem varchar(20) NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS titulo text,
      ADD COLUMN IF NOT EXISTS roteiro text,
      ADD COLUMN IF NOT EXISTS legenda_tiktok text,
      ADD COLUMN IF NOT EXISTS musica text,
      ADD COLUMN IF NOT EXISTS aprovado_por uuid,
      ADD COLUMN IF NOT EXISTS aprovado_por_email text,
      ADD COLUMN IF NOT EXISTS aprovado_em timestamptz,
      ADD COLUMN IF NOT EXISTS recusa_motivo text
  `);
  await sql.unsafe(`ALTER TABLE marketing_post ENABLE ROW LEVEL SECURITY`);
  console.log('ok: marketing_post com a fila de aprovação');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
