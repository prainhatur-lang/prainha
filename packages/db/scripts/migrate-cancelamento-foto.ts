// Foto do produto devolvido no cancelamento (motivo "Devolução…").
//
// Regra do dono (22/08/2026): reclamação ou "tira da conta" cancela sem foto;
// DEVOLUÇÃO (garrafa/lata que voltou pro bar) só com foto — o caixa gera o QR,
// o celular fotografa, a loja manda junto com o cancelamento. Fica em bytea
// mesmo (poucas por dia, ~150 KB cada); a lista nunca seleciona a coluna.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cancelamento-foto

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
  console.log('[1] cancelamento_item: foto');
  await run('coluna foto (bytea)', () =>
    sql`ALTER TABLE cancelamento_item ADD COLUMN IF NOT EXISTS foto bytea`,
  );
  await run('coluna foto_mime', () =>
    sql`ALTER TABLE cancelamento_item ADD COLUMN IF NOT EXISTS foto_mime varchar(40)`,
  );
  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
