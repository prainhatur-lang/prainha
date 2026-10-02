// Campanha de convite pelo WhatsApp: campanha_convite (1 linha por convidado).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:campanha-convite

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS campanha_convite (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      campanha varchar(60) NOT NULL,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      telefone varchar(11) NOT NULL,
      nome varchar(200),
      bairro varchar(100),
      grupo varchar(40),
      ultima_compra date,
      token varchar(64) NOT NULL UNIQUE,
      enviado_em timestamptz,
      wa_message_id text,
      erro text,
      clicou_em timestamptz,
      recusado_em timestamptz,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_campanha_convite_fone UNIQUE (campanha, telefone)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_campanha_convite_fone ON campanha_convite (telefone)`);
  await sql.unsafe(`ALTER TABLE campanha_convite ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] campanha_convite pronta');
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
