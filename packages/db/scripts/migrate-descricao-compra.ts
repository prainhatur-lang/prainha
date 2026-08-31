// Descrição de compra: como o item aparece pro fornecedor na cotação/pedido.
//
// POR QUE não usar o `nome` do produto: o nome vem do Consumer e o agente
// sobrescreve a cada sync — qualquer ajuste feito aqui sumiria sozinho. Além
// disso o nome do PDV carrega marca ("FILE MIGNON FRIBOI"), e mandar isso pro
// fornecedor já entrega a marca escolhida antes dele cotar.
//
//   produto.descricao_compra  → o padrão, vale pros próximos pedidos
//   cotacao_item.descricao    → o que este item mostra (snapshot da cotação)
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:descricao-compra

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
  console.log('[1] produto.descricao_compra');
  await run('coluna', () =>
    sql`ALTER TABLE produto ADD COLUMN IF NOT EXISTS descricao_compra varchar(200)`,
  );

  console.log('[2] cotacao_item.descricao');
  await run('coluna', () =>
    sql`ALTER TABLE cotacao_item ADD COLUMN IF NOT EXISTS descricao varchar(200)`,
  );

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
