// VENDEDOR — a pessoa com quem a casa fala, que é quem tem WhatsApp.
//
// O modelo antigo (telefone na linha do fornecedor) não fecha com a vida real:
//   · o mesmo vendedor atende VÁRIOS fornecedores (representa mais de uma
//     empresa, ou a mesma empresa cadastrada 11 vezes no Consumer);
//   · o mesmo fornecedor tem VÁRIOS vendedores (a Megga tem um de alimentos e
//     outro de bebidas — números diferentes, pedidos diferentes).
// Daí a N:N. E o vendedor é do GRUPO, não da filial: o Alex atende Prainha
// Bar, Tabuará e Prainha Mar com o mesmo número.
//
// O telefone aqui é o único lugar que o sync do Consumer não alcança.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:vendedor

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
  console.log('[1] tabela vendedor');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS vendedor (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      nome           varchar(120) NOT NULL,
      /** Só dígitos, com DDI: 5579999871286. */
      whatsapp       varchar(20),
      email          varchar(200),
      /** "vende bebidas", "atende só de manhã" — o que ajuda a escolher. */
      observacao     text,
      ativo          boolean NOT NULL DEFAULT true,
      criado_em      timestamptz NOT NULL DEFAULT now(),
      atualizado_em  timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('índice por whatsapp', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_vendedor_whatsapp ON vendedor (organizacao_id, whatsapp)`,
  );
  await run('nome único por organização', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_vendedor_org_nome ON vendedor (organizacao_id, lower(nome))`,
  );

  console.log('[2] vínculo N:N vendedor × fornecedor');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS vendedor_fornecedor (
      vendedor_id   uuid NOT NULL REFERENCES vendedor(id) ON DELETE CASCADE,
      fornecedor_id uuid NOT NULL REFERENCES fornecedor(id) ON DELETE CASCADE,
      /** O vendedor que recebe cotação/pedido quando há mais de um. */
      principal     boolean NOT NULL DEFAULT false,
      criado_em     timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (vendedor_id, fornecedor_id)
    )
  `);
  await run('índice por fornecedor', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_vend_forn_fornecedor ON vendedor_fornecedor (fornecedor_id)`,
  );

  // Tabela nova SEMPRE com RLS (ENABLE, nunca FORCE): sem isso a anon key do
  // Supabase lê tudo via PostgREST.
  console.log('[3] RLS');
  await run('vendedor', () => sql`ALTER TABLE vendedor ENABLE ROW LEVEL SECURITY`);
  await run('vendedor_fornecedor', () =>
    sql`ALTER TABLE vendedor_fornecedor ENABLE ROW LEVEL SECURITY`,
  );

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
