// Comprovante pro contador de TODO pagamento do Inter que deu baixa em conta a
// pagar — Pix por chave (pix_pagamento, folha inclusa), boleto do DDA pago no
// Inter e Pix casado com o extrato do Inter (dono 23/11/2026: "sim, todos").
// Uma linha por baixa: marca quando foi (uma vez só), pra quem e o último erro.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:comprovante-contador-baixa

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS comprovante_contador_baixa (
      baixa_id uuid PRIMARY KEY REFERENCES conta_pagar_baixa(id) ON DELETE CASCADE,
      filial_id uuid,
      enviado_em timestamptz,
      para text,
      erro text,
      tentativas integer NOT NULL DEFAULT 0,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE comprovante_contador_baixa ENABLE ROW LEVEL SECURITY;
  `);
  console.log('comprovante_contador_baixa OK (RLS ligado)');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
