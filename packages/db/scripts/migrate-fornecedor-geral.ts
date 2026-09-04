// fornecedor.geral — distribuidor que vende DE TUDO.
//
// Regra do dono (03/09/2026): "quando tiver produto que você não sabe quem
// vende, manda pros mais genéricos que têm tudo. Cássio só vende peixe, o
// menino do mercado só fruta e verdura — mas tem os distribuidores grandes que
// vendem todo tipo de coisa, e quando não souber a gente manda pra todos."
//
// Sem isso, a cotação de um item sem histórico não ia pra ninguém — foi o que
// aconteceu 2x seguidas: itens de limpeza cotados sem Saraiva nem Comel.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fornecedor-geral

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
  console.log('[1] coluna geral');
  await run('add column', () =>
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS geral boolean NOT NULL DEFAULT false`,
  );
  await run('índice', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_fornecedor_geral ON fornecedor (filial_id, geral) WHERE geral`,
  );
  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
