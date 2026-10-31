// Motivo da admissão (31/10/2026, dono): "se adicionou uma pessoa, por quê?".
// Texto curto (ex.: "substitui Ednéia", "reforço do verão") pedido pela tela
// /rh/escala-mensal enquanto a pessoa nova está nas pendências da escala.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:motivo-admissao

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS motivo_admissao varchar(200)`);
  console.log('[ok] funcionario.motivo_admissao pronta');
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
