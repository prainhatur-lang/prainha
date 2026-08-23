// O pedido do delivery do site precisa chegar no CAIXA da loja, igual ao do
// iFood: cai na fila, o caixa aceita ou recusa.
//
// Três colunas pra isso:
//  · enviado_loja_em — a loja já puxou. Enquanto null, o polling continua
//    oferecendo: caixa fechado ou loja sem rede não faz o pedido sumir.
//  · recusado_em / recusa_motivo — pedido pago e recusado precisa de estorno,
//    então fica registrado em vez de virar só um status genérico.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:delivery-loja

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function run(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${label}... `);
  await fn();
  console.log('OK');
}

async function main() {
  console.log('[1] colunas em delivery_pedido');
  await run('enviado_loja_em', () =>
    sql`ALTER TABLE delivery_pedido ADD COLUMN IF NOT EXISTS enviado_loja_em timestamptz`);
  await run('recusado_em', () =>
    sql`ALTER TABLE delivery_pedido ADD COLUMN IF NOT EXISTS recusado_em timestamptz`);
  await run('recusa_motivo', () =>
    sql`ALTER TABLE delivery_pedido ADD COLUMN IF NOT EXISTS recusa_motivo text`);

  console.log('[2] índice da fila que a loja puxa');
  await run('pendentes por filial', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_delivery_pedido_fila_loja
        ON delivery_pedido (filial_id, pago_em)
        WHERE enviado_loja_em IS NULL`);

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
