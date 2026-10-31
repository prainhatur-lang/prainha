// Permuta / parceria comercial (31/10/2026): contrato + crédito por casa.
// Ver packages/db/src/schema/permuta.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:permuta

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS permuta_contrato (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      parceiro_nome text NOT NULL,
      documento varchar(14),
      contato text,
      telefone varchar(30),
      email text,
      valor_total numeric(12,2) NOT NULL,
      contrapartida text,
      data_inicio date,
      data_fim date,
      observacao text,
      arquivo_path text,
      arquivo_nome varchar(200),
      criado_por text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      cancelado_em timestamptz,
      cancelado_por text,
      cancelado_motivo text
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_permuta_contrato_org ON permuta_contrato (organizacao_id, criado_em)`);
  await sql.unsafe(`ALTER TABLE permuta_contrato ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] permuta_contrato (+ RLS)');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS permuta_credito (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contrato_id uuid NOT NULL REFERENCES permuta_contrato(id) ON DELETE CASCADE,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      valor numeric(12,2) NOT NULL,
      status varchar(24) NOT NULL DEFAULT 'aguardando_cadastro',
      cliente_codigo_externo integer,
      agente_comando_id uuid,
      fiado_lancamento_id uuid,
      erro text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      lancado_em timestamptz
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_permuta_credito_contrato ON permuta_credito (contrato_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_permuta_credito_status ON permuta_credito (status)`);
  await sql.unsafe(`ALTER TABLE permuta_credito ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] permuta_credito (+ RLS)');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
