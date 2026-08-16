// Complementos do delivery: o que é oferecido DEPOIS da escolha do prato
// (arroz, purê, legumes, ponto da carne). Idempotente.
//
// Uso: pnpm --filter @concilia/db migrate:delivery-complemento

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  const r = await fn();
  console.log('OK');
  return r;
}

async function main() {
  await run('delivery_complemento', () =>
    sql`
      CREATE TABLE IF NOT EXISTS delivery_complemento (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        item_id uuid NOT NULL REFERENCES delivery_item(id) ON DELETE CASCADE,
        nome varchar(160) NOT NULL,
        preco numeric(10,2) NOT NULL DEFAULT 0,
        variante_id uuid REFERENCES produto_variante(id) ON DELETE SET NULL,
        ativo boolean NOT NULL DEFAULT true,
        ordem integer NOT NULL DEFAULT 0
      )
    `,
  );
  await run('idx item', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_complemento_item_idx ON delivery_complemento (item_id, ordem)`,
  );
  await run('idx filial', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_complemento_filial_idx ON delivery_complemento (filial_id)`,
  );
  await run('RLS', () => sql`ALTER TABLE delivery_complemento ENABLE ROW LEVEL SECURITY`);

  // O que o cliente escolheu fica gravado no item do pedido (snapshot com
  // nome e preço, igual ao resto — cardápio muda, pedido antigo não).
  await run('delivery_pedido_item.complementos', () =>
    sql`ALTER TABLE delivery_pedido_item ADD COLUMN IF NOT EXISTS complementos jsonb`,
  );

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
