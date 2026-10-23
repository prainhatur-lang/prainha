// Pedido sob encomenda (23/10/2026): entrada + restante.
// - pedido_compra_parcela: cada parcela do pedido vira uma conta_pagar.
// - pedido_compra_item aceita item em texto livre (produto_id nulo + descricao).
// - pedido_compra ganha frete, desconto e nº do orçamento.
// Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

async function main() {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_DIRECT/DATABASE_URL ausente');
  const sql = postgres(url, { prepare: false, ssl: 'require' });
  const run = async (name: string, fn: () => Promise<unknown>) => {
    process.stdout.write(`${name}... `);
    await fn();
    console.log('ok');
  };

  await run('pedido_compra colunas', () => sql`
    ALTER TABLE pedido_compra
      ADD COLUMN IF NOT EXISTS valor_frete numeric(14,2),
      ADD COLUMN IF NOT EXISTS valor_desconto numeric(14,2),
      ADD COLUMN IF NOT EXISTS referencia varchar(60)
  `);
  await run('pedido_compra_item.produto_id nulo', () => sql`
    ALTER TABLE pedido_compra_item ALTER COLUMN produto_id DROP NOT NULL
  `);
  await run('pedido_compra_item.descricao', () => sql`
    ALTER TABLE pedido_compra_item ADD COLUMN IF NOT EXISTS descricao text
  `);
  await run('pedido_compra_parcela', () => sql`
    CREATE TABLE IF NOT EXISTS pedido_compra_parcela (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      pedido_compra_id uuid NOT NULL REFERENCES pedido_compra(id) ON DELETE CASCADE,
      conta_pagar_id uuid,
      ordem integer NOT NULL,
      tipo varchar(10) NOT NULL,
      forma varchar(10) NOT NULL,
      quando varchar(10) NOT NULL,
      prazo_dias integer,
      valor numeric(14,2) NOT NULL,
      data_vencimento date NOT NULL,
      pronto_em timestamptz,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('idx_pedido_compra_parcela_pedido', () => sql`
    CREATE INDEX IF NOT EXISTS idx_pedido_compra_parcela_pedido ON pedido_compra_parcela (pedido_compra_id)
  `);
  await run('idx_pedido_compra_parcela_conta', () => sql`
    CREATE INDEX IF NOT EXISTS idx_pedido_compra_parcela_conta ON pedido_compra_parcela (conta_pagar_id)
  `);
  await run('RLS', () => sql`ALTER TABLE pedido_compra_parcela ENABLE ROW LEVEL SECURITY`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
