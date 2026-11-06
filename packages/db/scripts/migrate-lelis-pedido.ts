// Lelis (06/11/2026): pedido SEM NOTA pras casas. Baixa o estoque da Lelis,
// lança o a receber da Lelis e a conta a pagar na casa (fornecedor Lelis).
// A NF-e sai depois; o pedido guarda os itens e o preço.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:lelis-pedido

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS revenda_pedido (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      numero serial,
      destino_filial_id uuid NOT NULL REFERENCES filial(id),
      status varchar(12) NOT NULL DEFAULT 'ENVIADO',
      total numeric(14,2) NOT NULL DEFAULT 0,
      vencimento date NOT NULL,
      conta_pagar_id uuid,
      observacao text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      criado_por text,
      cancelado_em timestamptz,
      cancelado_por text
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_revenda_pedido_filial ON revenda_pedido (filial_id, criado_em DESC)`);
  await sql.unsafe(`ALTER TABLE revenda_pedido ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] revenda_pedido');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS revenda_pedido_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      pedido_id uuid NOT NULL REFERENCES revenda_pedido(id) ON DELETE CASCADE,
      revenda_produto_id uuid NOT NULL REFERENCES revenda_produto(id),
      descricao text NOT NULL,
      quantidade numeric(14,4) NOT NULL,
      preco_unit numeric(14,4) NOT NULL,
      custo_unit numeric(14,4),
      total numeric(14,2) NOT NULL
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_revenda_pedido_item_pedido ON revenda_pedido_item (pedido_id)`);
  await sql.unsafe(`ALTER TABLE revenda_pedido_item ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] revenda_pedido_item');

  await sql.unsafe(`ALTER TABLE revenda_movimento ADD COLUMN IF NOT EXISTS revenda_pedido_id uuid`);
  await sql.unsafe(`ALTER TABLE revenda_receber ADD COLUMN IF NOT EXISTS revenda_pedido_id uuid`);
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_revenda_mov_pedido
      ON revenda_movimento (revenda_pedido_id, revenda_produto_id, tipo) WHERE revenda_pedido_id IS NOT NULL`);
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_revenda_receber_pedido
      ON revenda_receber (revenda_pedido_id, parcela) WHERE revenda_pedido_id IS NOT NULL`);
  console.log('[ok] movimento/receber ligados ao pedido');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
