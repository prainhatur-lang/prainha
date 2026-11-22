// E-mails do Mercado Livre empurrados pelo script do Google: ml_email.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:mercadolivre-email

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ml_email (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id varchar(120) NOT NULL UNIQUE,
      recebido_em timestamptz NOT NULL,
      conta varchar(200),
      de varchar(300),
      assunto text,
      texto text,
      html text,
      tipo varchar(20),
      pedido_ml varchar(40),
      total numeric(12,2),
      dados jsonb,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ml_email_recebido_idx ON ml_email (recebido_em DESC)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ml_email_pedido_idx ON ml_email (pedido_ml)`);
  await sql.unsafe(`ALTER TABLE ml_email ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] ml_email pronta');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
