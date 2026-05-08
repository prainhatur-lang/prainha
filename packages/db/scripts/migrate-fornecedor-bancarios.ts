// Adiciona colunas bancarias em fornecedor (banco_nome, banco_agencia,
// banco_conta, chave_pix). Usado pra exportar arquivo de pagamento da folha.
// Idempotente.
//
// Uso: pnpm --filter @concilia/db migrate:fornecedor-bancarios

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

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
  console.log('[1] Colunas bancarias em fornecedor');
  await run('banco_nome', () =>
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS banco_nome varchar(100)`,
  );
  await run('banco_agencia', () =>
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS banco_agencia varchar(20)`,
  );
  await run('banco_conta', () =>
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS banco_conta varchar(30)`,
  );
  await run('chave_pix', () =>
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS chave_pix varchar(100)`,
  );

  console.log('\nMigration concluida.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
