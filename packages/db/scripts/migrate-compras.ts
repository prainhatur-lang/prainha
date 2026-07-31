// Aplica migration delta do modulo Compras/Cotacao:
//   - ALTER produto ADD categoria_compras
//   - CREATE TABLE marca (cadastro de marcas por filial)
//   - CREATE TABLE produto_marca_aceita (N:N produto x marca)
//
// Idempotente via IF NOT EXISTS. Pode rodar varias vezes sem efeito colateral.
//
// Uso: pnpm --filter @concilia/db migrate:compras

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function run(name: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log('OK');
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function main() {
  console.log('[1] Coluna nova em produto');
  await run('produto.categoria_compras', () =>
    sql`ALTER TABLE produto ADD COLUMN IF NOT EXISTS categoria_compras varchar(50)`,
  );

  console.log('[2] Tabela marca');
  await run('CREATE TABLE marca', () =>
    sql`
      CREATE TABLE IF NOT EXISTS marca (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        nome varchar(100) NOT NULL,
        ativa boolean NOT NULL DEFAULT true,
        criado_em timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT uq_marca_filial_nome UNIQUE (filial_id, nome)
      )
    `,
  );
  await run('idx_marca_nome', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_marca_nome ON marca (filial_id, nome)`,
  );

  console.log('[3] Tabela produto_marca_aceita');
  await run('CREATE TABLE produto_marca_aceita', () =>
    sql`
      CREATE TABLE IF NOT EXISTS produto_marca_aceita (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
        marca_id uuid NOT NULL REFERENCES marca(id) ON DELETE CASCADE,
        criado_em timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT uq_pma_produto_marca UNIQUE (produto_id, marca_id)
      )
    `,
  );
  await run('idx_pma_produto', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_pma_produto ON produto_marca_aceita (filial_id, produto_id)`,
  );
  await run('idx_pma_marca', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_pma_marca ON produto_marca_aceita (filial_id, marca_id)`,
  );

  console.log('\nMigration concluida.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
