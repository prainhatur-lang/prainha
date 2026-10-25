// Instagram → TikTok automático por casa (/marketing). Pedido do dono 25/10/2026.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:marketing-espelho

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS marketing_espelho (
      filial_id uuid PRIMARY KEY,
      ativo boolean NOT NULL DEFAULT false,
      desde timestamptz NOT NULL DEFAULT now(),
      atualizado_por text,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS marketing_espelho_envio (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL,
      ig_post_id varchar(40) NOT NULL,
      ig_link text,
      ig_quando timestamptz,
      status varchar(12) NOT NULL,
      tentativas integer NOT NULL DEFAULT 0,
      publish_id text,
      tipo varchar(10),
      erro text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_espelho_envio_post ON marketing_espelho_envio (filial_id, ig_post_id)`,
  );
  await sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_marketing_espelho_envio_filial ON marketing_espelho_envio (filial_id, criado_em)`,
  );
  await sql.unsafe(`ALTER TABLE marketing_espelho ENABLE ROW LEVEL SECURITY`);
  await sql.unsafe(`ALTER TABLE marketing_espelho_envio ENABLE ROW LEVEL SECURITY`);
  console.log('ok: marketing_espelho + marketing_espelho_envio (RLS ligado)');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
