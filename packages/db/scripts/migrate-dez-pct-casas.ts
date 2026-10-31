// 10% dividido entre casas (31/10/2026, dono): quem trabalha pras três casas
// (funcionário da Lelis: Claudio, Roberto) não recebe a parte inteira em cada
// uma. Em cada casa recebe 1/N da parte dele; o resto fica com a empresa
// daquela casa. NULL (ou 1) = parte inteira, como sempre.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:dez-pct-casas

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE fornecedor_folha ADD COLUMN IF NOT EXISTS dez_pct_casas integer`);
  console.log('[ok] fornecedor_folha.dez_pct_casas pronta');
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
