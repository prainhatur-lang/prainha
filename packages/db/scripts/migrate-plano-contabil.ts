/**
 * Plano de contas do contador (24/10/2026): tabela `plano_contabil` (plano do
 * escritório, por organização) + colunas `conta_contabil*` em categoria_conta
 * (de-para). Aditiva e idempotente; tabela nova com RLS.
 *
 * Uso: pnpm --filter @concilia/db migrate:plano-contabil
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS plano_contabil (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      classificacao varchar(30) NOT NULL,
      codigo_reduzido integer,
      nome varchar(200) NOT NULL,
      sintetica boolean NOT NULL DEFAULT false,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_plano_contabil_org_class UNIQUE (organizacao_id, classificacao)
    )`);
  await sql.unsafe(`ALTER TABLE plano_contabil ENABLE ROW LEVEL SECURITY`);

  await sql.unsafe(`ALTER TABLE categoria_conta ADD COLUMN IF NOT EXISTS conta_contabil varchar(30)`);
  await sql.unsafe(`ALTER TABLE categoria_conta ADD COLUMN IF NOT EXISTS conta_contabil_situacao varchar(12)`);
  await sql.unsafe(`ALTER TABLE categoria_conta ADD COLUMN IF NOT EXISTS conta_contabil_obs text`);
  await sql.unsafe(`ALTER TABLE categoria_conta ADD COLUMN IF NOT EXISTS conta_contabil_em timestamptz`);
  await sql.unsafe(`ALTER TABLE categoria_conta ADD COLUMN IF NOT EXISTS conta_contabil_por uuid`);

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM plano_contabil`;
  console.log(`[ok] plano contábil pronto (${n} conta(s))`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
