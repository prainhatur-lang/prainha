// Cria cobranca_mesa: conta de mesa paga no cartao pelo proprio cliente.
// O servidor da loja e' HTTP, entao a captura de cartao acontece aqui (HTTPS).
// Idempotente.
// Uso: pnpm --filter @concilia/db migrate:cobranca-mesa

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS cobranca_mesa (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ref varchar(64) NOT NULL UNIQUE,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      mesa integer NOT NULL,
      valor_centavos integer NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'aguardando',
      tipo_pagamento varchar(20),
      payment_id varchar(60),
      autorizacao varchar(60),
      bandeira varchar(30),
      erro text,
      expira_em timestamptz NOT NULL,
      pago_em timestamptz,
      criado_em timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE cobranca_mesa ADD COLUMN IF NOT EXISTS autenticado_3ds boolean NOT NULL DEFAULT false`;
  await sql`CREATE INDEX IF NOT EXISTS cobranca_mesa_filial_status_idx ON cobranca_mesa (filial_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS cobranca_mesa_criado_idx ON cobranca_mesa (criado_em)`;
  // RLS: a tabela e' escrita/lida so pelo app (role postgres, que bypassa),
  // mas fica habilitada pra nao abrir buraco via anon key do PostgREST.
  await sql`ALTER TABLE cobranca_mesa ENABLE ROW LEVEL SECURITY`;

  const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM cobranca_mesa`;
  console.log(`ok — cobranca_mesa pronta (${n} registros)`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
