// Folha semanal: coluna fornecedor_folha.diarista_ate — quem foi registrado
// no meio da semana (diarista → funcionário) recebe diária até essa data
// (inclusive) sem precisar lançar acréscimo na mão.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:diarista-ate

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE fornecedor_folha
      ADD COLUMN IF NOT EXISTS diarista_ate date
  `);
  console.log('ok: fornecedor_folha.diarista_ate');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
