// Vale-presente por VALOR (comprado no site): coluna tipo = 'menu' | 'valor'.
// 'menu' = montado pela Nina com itens do cardápio; 'valor' = crédito livre.
// Uso: pnpm --filter @concilia/db migrate:vale-presente-valor

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`ALTER TABLE vale_presente ADD COLUMN IF NOT EXISTS tipo varchar(10) NOT NULL DEFAULT 'menu'`;
  await sql`ALTER TABLE vale_presente ENABLE ROW LEVEL SECURITY`;
  const [r] = await sql`SELECT count(*)::int AS n FROM vale_presente`;
  console.log('ok — vale_presente.tipo; linhas:', r?.n);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
