// Perdas/quebras da semana que abatem o pote dos FUNCIONARIOS no 10%.
//
// Caso real: garcom quebra copos de proposito. O prejuizo tem que sair da
// parte da equipe (pp_funcionarios), no DIA em que aconteceu — quem
// trabalhou naquele dia sente o desconto, quem estava de folga nao.
// Empresa e gerente continuam recebendo os pp deles sobre o 10% cheio.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:folha-perda

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
  console.log('[1] tabela folha_perda');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS folha_perda (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      folha_semana_id uuid NOT NULL REFERENCES folha_semana(id) ON DELETE CASCADE,
      dia             date NOT NULL,
      valor           numeric(10,2) NOT NULL,
      descricao       varchar(200),
      criado_em       timestamptz NOT NULL DEFAULT now(),
      criado_por      uuid
    )
  `);
  await run('index (folha, dia)', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_folha_perda_folha ON folha_perda (folha_semana_id, dia)`,
  );

  // Tabela nova SEMPRE com RLS (ENABLE, nunca FORCE): sem isso a anon key do
  // Supabase le/escreve a tabela inteira via PostgREST.
  console.log('[2] RLS');
  await run('enable row level security', () =>
    sql`ALTER TABLE folha_perda ENABLE ROW LEVEL SECURITY`,
  );

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
