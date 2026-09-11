// Conciliação sob demanda do iFood: guarda o requestId de cada pedido.
//
// O iFood aceita um pedido por loja+competência a cada 6 h (409 no resto) e o
// requestId vale 24 h — sem guardar, recarregar a tela perde o arquivo.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:ifood-conciliacao

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
  console.log('[1] ifood_conciliacao_pedido');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS ifood_conciliacao_pedido (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id     uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      merchant_id   varchar(80) NOT NULL,
      competencia   varchar(7) NOT NULL,
      request_id    varchar(80) NOT NULL,
      status        varchar(30) NOT NULL DEFAULT 'created',
      fase          varchar(20) NOT NULL DEFAULT 'processando',
      erro          text,
      pedido_por    uuid,
      pedido_em     timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      pronto_em     timestamptz
    )
  `);
  await run('index filial+competencia', () => sql`
    CREATE INDEX IF NOT EXISTS ifood_conciliacao_pedido_filial_comp_idx
      ON ifood_conciliacao_pedido (filial_id, competencia, pedido_em)
  `);

  // Tabela nova SEMPRE com RLS (ENABLE, nunca FORCE).
  console.log('[2] RLS');
  await run('enable row level security', () =>
    sql`ALTER TABLE ifood_conciliacao_pedido ENABLE ROW LEVEL SECURITY`,
  );

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
