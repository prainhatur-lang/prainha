// Guias de imposto da contabilidade (22/10/2026): tabela imposto_guia. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS imposto_guia (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      arquivo_path text NOT NULL UNIQUE,
      arquivo_hash varchar(64) NOT NULL UNIQUE,
      arquivo_nome text,
      mime varchar(60),
      lido jsonb,
      erro text,
      tipo varchar(20),
      contribuinte_cnpj varchar(14),
      contribuinte_nome text,
      competencia varchar(7),
      vencimento date,
      valor numeric(14,2),
      codigo_barras varchar(60),
      descricao text,
      regra varchar(12),
      pagadora_filial_id uuid,
      pagadora_nome text,
      rateio jsonb NOT NULL DEFAULT '[]'::jsonb,
      conta_guia_id uuid,
      status varchar(12) NOT NULL DEFAULT 'LIDA',
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      lancado_por uuid,
      lancado_em timestamptz
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS imposto_guia_status_idx ON imposto_guia (status, criado_em)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS imposto_guia_barras_idx ON imposto_guia (codigo_barras)`);
  await sql.unsafe(`ALTER TABLE imposto_guia ENABLE ROW LEVEL SECURITY`);
  console.log('ok: imposto_guia');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
