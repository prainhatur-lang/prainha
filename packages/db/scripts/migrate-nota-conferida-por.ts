// Quem conferiu a nota/pedido (nota_compra.conferida_por). Pedido do dono em
// 20/10/2026: na tela de Pedidos a pagar por Pix, ver o pedido, quem lançou e
// quem conferiu. Antes disso só se guardava a hora da conferência.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:nota-conferida-por

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS conferencia_obs text`);
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS conferida_em timestamptz`);
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS conferida_por uuid`);
  console.log('ok: nota_compra.conferida_por');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
