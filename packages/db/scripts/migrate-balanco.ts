// BALANÇO DO DIA — a foto que o vendas-local manda pra nuvem de tempos em
// tempos (comandas, ocupação, atrasos, cancelamentos, estornos, reclamações…).
// Cada envio é uma linha; a última do dia é o balanço final.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:balanco

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function run(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${label}... `);
  await fn();
  console.log('OK');
}

async function main() {
  console.log('[1] tabela balanco_loja');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS balanco_loja (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id    uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      dia          date NOT NULL,
      capturado_em timestamptz NOT NULL,
      versao       varchar(16),
      dados        jsonb NOT NULL,
      recebido_em  timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('índice filial/dia/capturado', () =>
    sql`CREATE INDEX IF NOT EXISTS bl_filial_dia_capturado ON balanco_loja (filial_id, dia, capturado_em)`,
  );
  await run('row level security', () => sql`ALTER TABLE balanco_loja ENABLE ROW LEVEL SECURITY`);
  console.log('pronto.');
}

main()
  .catch((e) => {
    console.error('\nERRO:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
