// Estudo de equipe mês a mês (10/11/2026): rh_estudo_equipe guarda, por casa
// e mês, o resumo do cálculo, a análise da IA e a decisão registrada.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:estudo-equipe

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS rh_estudo_equipe (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      competencia varchar(7) NOT NULL,
      dados jsonb,
      analise text,
      analise_em timestamptz,
      analise_por text,
      decisao text,
      decisao_em timestamptz,
      decisao_por text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_rh_estudo_equipe UNIQUE (filial_id, competencia)
    );
    ALTER TABLE rh_estudo_equipe ENABLE ROW LEVEL SECURITY;
  `);
  console.log('ok: rh_estudo_equipe (RLS habilitado)');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
