// funcionario.dados_registro (jsonb): dados pessoais do registro (RG, CTPS,
// PIS, filiação…) + termos do contrato de trabalho gerado pelo sistema.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:funcionario-dados-registro

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS dados_registro jsonb`);
  console.log('[ok] funcionario.dados_registro pronta');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
