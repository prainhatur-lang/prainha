// Cria traducao_texto (tradução dos textos do delivery pra en/es/fr/it).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:traducao-texto
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS traducao_texto (
      chave varchar(32) PRIMARY KEY,
      pt text NOT NULL,
      en text NOT NULL,
      es text NOT NULL,
      fr text NOT NULL,
      it text NOT NULL,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`ALTER TABLE traducao_texto ENABLE ROW LEVEL SECURITY`);
  console.log('ok: traducao_texto');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
