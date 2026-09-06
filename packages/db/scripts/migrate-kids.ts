// Espaço Kids: kids_checkin + kids_mensagem (ponte do WhatsApp pro
// vendas-local). Spec: docs/superpowers/specs/2026-09-03-espaco-kids-design.md
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:kids

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS kids_checkin (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo varchar(8) NOT NULL,
      phone_number_id text NOT NULL,
      telefone_digitado varchar(20) NOT NULL,
      telefone_confirmado varchar(20),
      responsavel_nome varchar(160) NOT NULL,
      criancas text NOT NULL,
      mesa integer,
      link_camera text,
      status varchar(20) NOT NULL DEFAULT 'aguardando',
      confirmado_em timestamptz,
      encerrado_em timestamptz,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS ux_kids_checkin_codigo ON kids_checkin (filial_id, codigo)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ix_kids_checkin_tel ON kids_checkin (phone_number_id, telefone_confirmado, status)`);
  await sql.unsafe(`ALTER TABLE kids_checkin ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] kids_checkin pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS kids_mensagem (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      checkin_id uuid NOT NULL REFERENCES kids_checkin(id) ON DELETE CASCADE,
      direcao varchar(10) NOT NULL,
      texto text NOT NULL,
      wa_message_id text,
      erro text,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ix_kids_mensagem_checkin ON kids_mensagem (checkin_id, criado_em)`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS ux_kids_mensagem_wa ON kids_mensagem (wa_message_id) WHERE wa_message_id IS NOT NULL`);
  await sql.unsafe(`ALTER TABLE kids_mensagem ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] kids_mensagem pronta');

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
