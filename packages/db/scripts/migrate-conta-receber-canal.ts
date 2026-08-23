// CONTA A RECEBER DE CANAL (iFood etc.) — dinheiro já cobrado do cliente
// no canal, ainda não repassado pra casa.
//
// Pedido do dono, 23/08/2026: pedido do iFood chegava no caixa como "aberto,
// R$ 0,00 pago" — parecia dívida do cliente, mas o dinheiro já está com o
// iFood. Agora esse tipo de pedido gera um lançamento aqui em vez de ficar
// pendurado esperando o caixa receber (ver ingest/pdv/route.ts).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:conta-receber-canal

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS conta_receber_canal (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      canal varchar(20) NOT NULL,
      pedido_codigo_externo integer NOT NULL,
      pedido_numero integer,
      nome_cliente text,
      data_pedido timestamptz NOT NULL,
      valor_bruto numeric(14,2) NOT NULL,
      valor_liquido_esperado numeric(14,2),
      valor_recebido numeric(14,2),
      data_recebimento date,
      status varchar(12) NOT NULL DEFAULT 'aberto',
      observacao text,
      recebido_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(`ALTER TABLE conta_receber_canal ADD COLUMN IF NOT EXISTS valor_liquido_esperado numeric(14,2)`);
  await sql.unsafe(`ALTER TABLE conta_receber_canal ADD COLUMN IF NOT EXISTS observacao text`);
  await sql.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_crc_filial_pedido') THEN
        ALTER TABLE conta_receber_canal ADD CONSTRAINT uq_crc_filial_pedido UNIQUE (filial_id, pedido_codigo_externo);
      END IF;
    END $$`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_crc_filial_status ON conta_receber_canal (filial_id, status)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_crc_canal ON conta_receber_canal (filial_id, canal)`);
  // CREATE TABLE nova -> sempre RLS (anon key do Supabase lê/escreve via
  // PostgREST sem isso — aconteceu 2x, jun e ago/2026).
  await sql.unsafe(`ALTER TABLE conta_receber_canal ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] conta_receber_canal pronta');
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
