// pronto_em / entregue_em no pedido_item: os toques do KDS da loja
// (vendas-local, tabela marca) passam a subir pra nuvem — é o que alimenta
// os tempos de produção/entrega no espelho do pedido.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:item-kds

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE pedido_item ADD COLUMN IF NOT EXISTS pronto_em timestamp with time zone`;
  await sql`ALTER TABLE pedido_item ADD COLUMN IF NOT EXISTS entregue_em timestamp with time zone`;
  console.log('colunas pronto_em/entregue_em OK');
  await sql.end();
  console.log('Migration concluida.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
