// Comprovante do Pix pago pelo sistema vai pro WhatsApp de quem recebeu.
// Cada tentativa vira uma linha: número, de onde veio o número, como foi
// (janela de 24 h, template ou wa.me), status (ENVIADO/ENTREGUE/LIDA/ERRO/
// SEM_NUMERO/SEM_TEMPLATE/NAO_ENVIAR) e o wamid pra o webhook atualizar.
// Pedido do dono em 28/10/2026.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:pix-comprovante

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS pix_comprovante_envio (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      pix_pagamento_id uuid NOT NULL,
      filial_id uuid NOT NULL,
      telefone varchar(20),
      origem_fone varchar(30),
      modo varchar(20),
      status varchar(20) NOT NULL,
      wamid text,
      erro text,
      usuario_email text,
      auto boolean NOT NULL DEFAULT false,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_pix_comprovante_pix ON pix_comprovante_envio (pix_pagamento_id, criado_em)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_pix_comprovante_wamid ON pix_comprovante_envio (wamid)`);
  await sql.unsafe(`ALTER TABLE pix_comprovante_envio ENABLE ROW LEVEL SECURITY`);
  console.log('ok: pix_comprovante_envio (RLS ligado)');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
