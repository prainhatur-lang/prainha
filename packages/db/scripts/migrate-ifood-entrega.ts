// ifood_entrega — entregador do iFood chamado pela loja (módulo Shipping).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:ifood-entrega
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS ifood_entrega (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
    origem varchar(10) NOT NULL,
    delivery_pedido_id uuid REFERENCES delivery_pedido(id) ON DELETE SET NULL,
    ifood_order_id text,
    tracking_url text,
    status varchar(20) NOT NULL DEFAULT 'SOLICITADO',
    status_ifood text,
    quote_id text,
    valor numeric(10,2),
    cotacao jsonb,
    entregador jsonb,
    erro text,
    cancelado_motivo text,
    criado_por uuid,
    criado_em timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    cancelado_em timestamptz
  )`;
  await sql`CREATE INDEX IF NOT EXISTS ifood_entrega_pedido_idx ON ifood_entrega (delivery_pedido_id)`;
  await sql`CREATE INDEX IF NOT EXISTS ifood_entrega_order_idx ON ifood_entrega (ifood_order_id)`;
  await sql`CREATE INDEX IF NOT EXISTS ifood_entrega_filial_idx ON ifood_entrega (filial_id, criado_em)`;
  await sql`ALTER TABLE ifood_entrega ENABLE ROW LEVEL SECURITY`;
  console.log('OK: ifood_entrega pronta (RLS ligada)');
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
