// Peso relativo de produção no cadastro do produto. Na OP, o custo das
// entradas se divide pelos kg das saídas × esse peso: apara/subproduto com
// 0,3 carrega 30% do custo por kg do corte nobre. Null = não configurado
// (a OP usa o último peso usado pra esse produto, ou 1). Dono 20/10/2026.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:peso-relativo-produto

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(
    `ALTER TABLE produto ADD COLUMN IF NOT EXISTS peso_relativo_producao numeric(10,4)`,
  );
  console.log('ok: produto.peso_relativo_producao');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
