// Credencial de pagamento POR FILIAL (Cielo e-commerce + 3DS).
//
// Cada casa tem o próprio estabelecimento na Cielo — o dinheiro do delivery da
// Tabuará não pode cair na conta do Prainha. Antes disso, as chaves eram env
// global (CIELO_MERCHANT_ID etc) e valiam pra filial toda.
//
// `valor` é o segredo CIFRADO (AES-256-GCM, apps/web/src/lib/segredo.ts); a
// chave da cifra mora em CREDENCIAL_SECRET, fora do banco. Filial sem linha
// aqui cai nas env globais — o Prainha segue funcionando sem migrar dado.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:filial-credencial

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
  console.log('[1] tabela filial_credencial');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS filial_credencial (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id      uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      provedor       varchar(20) NOT NULL,
      chave          varchar(40) NOT NULL,
      valor          text NOT NULL,
      pista          varchar(40),
      atualizado_por uuid,
      criado_em      timestamptz NOT NULL DEFAULT now(),
      atualizado_em  timestamptz NOT NULL DEFAULT now()
    )
  `);

  await run('unique (filial, provedor, chave)', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_filial_credencial
        ON filial_credencial (filial_id, provedor, chave)`,
  );

  // Tabela nova SEMPRE com RLS (ENABLE, nunca FORCE): sem isso a anon key do
  // Supabase lê a tabela inteira via PostgREST — e aqui tem chave de cartão,
  // ainda que cifrada. Já vazou 2x por esquecer isso (jun e ago/2026).
  console.log('[2] RLS');
  await run('enable row level security', () =>
    sql`ALTER TABLE filial_credencial ENABLE ROW LEVEL SECURITY`,
  );

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
