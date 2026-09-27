// Saúde do servidor da loja: histórico de quedas (buraco no heartbeat) e
// diagnóstico do log do Windows. Idempotente. Uso: pnpm --filter @concilia/db migrate:loja-saude

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS loja_queda (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
    caiu_em timestamptz NOT NULL,
    voltou_em timestamptz NOT NULL,
    segundos integer NOT NULL
  )`;
  await sql`CREATE INDEX IF NOT EXISTS loja_queda_filial_idx ON loja_queda (filial_id, caiu_em)`;
  await sql`ALTER TABLE loja_queda ENABLE ROW LEVEL SECURITY`;
  await sql`CREATE TABLE IF NOT EXISTS loja_diagnostico (
    filial_id uuid PRIMARY KEY REFERENCES filial(id) ON DELETE CASCADE,
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    dados jsonb NOT NULL
  )`;
  await sql`ALTER TABLE loja_diagnostico ENABLE ROW LEVEL SECURITY`;
  console.log('Pronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
