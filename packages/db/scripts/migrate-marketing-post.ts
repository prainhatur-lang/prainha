// Tabela dos posts da tela /marketing → Publicar (fotos/vídeo + legenda +
// redes + agendamento). Pedido do dono em 21/10/2026.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:marketing-post

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS marketing_post (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL,
      midias jsonb NOT NULL,
      legenda text NOT NULL DEFAULT '',
      redes jsonb NOT NULL,
      agendado_para timestamptz,
      status varchar(20) NOT NULL DEFAULT 'RASCUNHO',
      resultado jsonb,
      erro text,
      criado_por uuid,
      criado_por_email text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      publicado_em timestamptz
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_marketing_post_filial ON marketing_post (filial_id, criado_em)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_marketing_post_agenda ON marketing_post (status, agendado_para)`);
  await sql.unsafe(`ALTER TABLE marketing_post ENABLE ROW LEVEL SECURITY`);
  console.log('ok: marketing_post (RLS ligado)');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
