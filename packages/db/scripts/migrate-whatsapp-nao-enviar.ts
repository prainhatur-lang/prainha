// Lista de quem não recebe mais mensagem de divulgação pelo WhatsApp
// (whatsapp_nao_enviar) + recibo de entrega do convite de campanha
// (campanha_convite.entrega_*), que até aqui não era guardado.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:whatsapp-nao-enviar

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS whatsapp_nao_enviar (
      telefone varchar(11) PRIMARY KEY,
      motivo varchar(20) NOT NULL,
      detalhe text,
      origem varchar(30),
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`ALTER TABLE whatsapp_nao_enviar ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] whatsapp_nao_enviar pronta');

  await sql.unsafe(`ALTER TABLE campanha_convite ADD COLUMN IF NOT EXISTS entrega_status varchar(12)`);
  await sql.unsafe(`ALTER TABLE campanha_convite ADD COLUMN IF NOT EXISTS entrega_status_em timestamptz`);
  await sql.unsafe(`ALTER TABLE campanha_convite ADD COLUMN IF NOT EXISTS entrega_erro text`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_campanha_convite_wamid ON campanha_convite (wa_message_id)`);
  console.log('[ok] campanha_convite.entrega_* prontas');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
