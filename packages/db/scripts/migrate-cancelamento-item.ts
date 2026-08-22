// Histórico de cancelamentos do caixa (vendas-local) na nuvem — COM motivo.
//
// O Consumer só marca ITENSPEDIDO.DATADELETE; o motivo, quem cancelou e quem
// autorizou só existem na tabela `cancelamento` do servidor da loja. A loja
// envia em lote pro /api/loja/cancelamentos e esta tabela recebe; a chave
// (filial_id, id_local) faz o reenvio ser inofensivo.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cancelamento-item

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
  console.log('[1] tabela cancelamento_item');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS cancelamento_item (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id    uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      id_local     bigint NOT NULL,
      quando       timestamptz NOT NULL,
      tipo         varchar(10) NOT NULL,
      login        varchar(60),
      gerente      varchar(60),
      numero       integer,
      pedido_fb    integer,
      item_codigo  bigint,
      nome         text,
      valor        numeric(14,2),
      status_item  varchar(20),
      motivo       text,
      area_codigo  integer,
      recebido_em  timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('unique (filial, id_local)', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS ci_filial_id_local ON cancelamento_item (filial_id, id_local)`,
  );
  await run('index por data', () =>
    sql`CREATE INDEX IF NOT EXISTS ci_filial_quando ON cancelamento_item (filial_id, quando)`,
  );

  // Tabela nova SEMPRE com RLS (ENABLE, nunca FORCE): sem isso a anon key do
  // Supabase lê a tabela inteira via PostgREST.
  console.log('[2] RLS');
  await run('enable row level security', () =>
    sql`ALTER TABLE cancelamento_item ENABLE ROW LEVEL SECURITY`,
  );

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
