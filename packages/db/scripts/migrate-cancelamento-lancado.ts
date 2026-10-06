// Hora do LANCAMENTO do item cancelado — o relatorio mostra "lancado 14:43 ·
// cancelado 15:48". A loja (vendas-local) manda junto pelo /api/loja/cancelamentos.
//
// Uso: pnpm --filter @concilia/db migrate:cancelamento-lancado

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  process.stdout.write('  cancelamento_item.lancado_em... ');
  await sql`ALTER TABLE cancelamento_item ADD COLUMN IF NOT EXISTS lancado_em timestamptz`;
  console.log('OK');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
