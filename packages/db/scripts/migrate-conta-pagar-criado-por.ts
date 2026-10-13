// Quem lançou a conta a pagar: colunas conta_pagar.criado_por (id do usuário
// logado) e criado_em. Pedido do dono em 13/10/2026 ("tem que está registrado"):
// uma conta de R$ 3.611,00 digitada na mão na Prainha Mar não tinha como saber
// de quem era. Conta antiga fica com as duas colunas vazias (não há de onde tirar).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:conta-pagar-criado-por

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS criado_por uuid`);
  await sql.unsafe(`ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS criado_em timestamptz`);
  console.log('ok: conta_pagar.criado_por / criado_em');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
