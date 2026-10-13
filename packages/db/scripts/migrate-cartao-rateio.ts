// Rateio de lançamento de cartão entre casas (/financeiro/cartoes): coluna
// cartao_lancamento.rateio (jsonb, lista dos ids das casas que dividem a
// despesa em partes iguais). Pedido do dono em 13/10/2026: banco de dados do
// sistema, hospedagem e afins servem às três casas.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cartao-rateio

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE cartao_lancamento ADD COLUMN IF NOT EXISTS rateio jsonb`);
  console.log('ok: cartao_lancamento.rateio');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
