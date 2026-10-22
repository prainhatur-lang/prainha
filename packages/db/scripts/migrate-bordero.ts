// Borderô (22/10/2026): tabela bordero + conta_pagar.bordero_id. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS bordero (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      folha_semana_id uuid,
      intermediario_id uuid NOT NULL,
      conta_pagar_id uuid,
      valor numeric(14,2) NOT NULL,
      qtd_contas integer NOT NULL,
      data_vencimento date NOT NULL,
      status varchar(10) NOT NULL DEFAULT 'ATIVO',
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      desfeito_por uuid,
      desfeito_em timestamptz
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS bordero_folha_idx ON bordero (folha_semana_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS bordero_filial_idx ON bordero (filial_id, status)`);
  await sql.unsafe(`ALTER TABLE bordero ENABLE ROW LEVEL SECURITY`);
  await sql.unsafe(`ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS bordero_id uuid`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_conta_pagar_bordero ON conta_pagar (bordero_id) WHERE bordero_id IS NOT NULL`);
  console.log('ok: bordero + conta_pagar.bordero_id');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
