// fornecedor.pix_favorecido: nome de QUEM RECEBE o Pix quando não é o próprio
// fornecedor. Pedido do dono em 13/10/2026: a Butique da Carne (Brunior) é paga
// por Pix em nome de Elizabeth Vieira dos Santos — no extrato do banco aparece
// a pessoa, não o fornecedor. A chave continua em fornecedor.chave_pix.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fornecedor-pix-favorecido

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS pix_favorecido varchar(200)`);
  console.log('ok: fornecedor.pix_favorecido');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
