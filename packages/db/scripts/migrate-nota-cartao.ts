// Nota de entrada paga no cartão de crédito (pedido do dono, 12/11/2026): na
// hora de lançar a nota informa qual cartão e em quantas vezes, pra depois
// fazer o encontro com as parcelas da fatura (cartao_lancamento).
// Colunas nota_compra.cartao_banco / cartao_final / cartao_parcelas.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:nota-cartao

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS cartao_banco varchar(60)`);
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS cartao_final varchar(8)`);
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS cartao_parcelas integer`);
  console.log('ok: nota_compra.cartao_banco / cartao_final / cartao_parcelas');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
