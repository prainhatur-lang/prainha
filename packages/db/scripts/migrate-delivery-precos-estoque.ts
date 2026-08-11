// Delivery: preco do iFood por item + trava de estoque real do Consumer.
// Idempotente (ADD COLUMN IF NOT EXISTS).
//
// Uso: pnpm --filter @concilia/db migrate:delivery-precos-estoque

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  try {
    const r = await fn();
    console.log('OK');
    return r;
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function main() {
  await run('delivery_item.preco_ifood', () =>
    sql`ALTER TABLE delivery_item ADD COLUMN IF NOT EXISTS preco_ifood numeric(10,2)`,
  );
  await run('delivery_item.checar_estoque', () =>
    sql`ALTER TABLE delivery_item ADD COLUMN IF NOT EXISTS checar_estoque boolean NOT NULL DEFAULT true`,
  );
  // Busca do painel/cardápio passa pelo vínculo com a variante do salão.
  await run('idx delivery_item.variante_id', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_item_variante_idx ON delivery_item (variante_id)`,
  );

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
