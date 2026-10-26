// Rateio do contador (26/10/2026): tabela imposto_rateio_contador. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS imposto_rateio_contador (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cnpj varchar(14) NOT NULL,
      competencia varchar(7) NOT NULL,
      linhas jsonb NOT NULL DEFAULT '[]'::jsonb,
      totais jsonb NOT NULL DEFAULT '{}'::jsonb,
      arquivo_path text,
      arquivo_hash varchar(64),
      lido jsonb,
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS imposto_rateio_contador_unico ON imposto_rateio_contador (cnpj, competencia)`,
  );
  await sql.unsafe(`ALTER TABLE imposto_rateio_contador ENABLE ROW LEVEL SECURITY`);
  console.log('ok: imposto_rateio_contador');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
