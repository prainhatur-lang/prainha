// Habilita Row Level Security (RLS) em TODAS as tabelas do schema public.
//
// CONTEXTO: o Supabase expoe o schema public via PostgREST usando a anon key
// (que e PUBLICA — vai no bundle do browser). Sem RLS + com os grants default
// do Supabase (anon/authenticated tem SELECT/INSERT/UPDATE/DELETE), QUALQUER
// pessoa na internet le e escreve todos os dados (fornecedores, folha, etc).
//
// O app NAO usa PostgREST pra dados — acessa tudo via Drizzle/postgres driver
// (role `postgres`, que tem rolbypassrls=true). Entao habilitar RLS deny-all
// (ENABLE sem policy) bloqueia anon/authenticated mas NAO afeta o app.
//
// IMPORTANTE: usar ENABLE (nao FORCE). Com ENABLE o owner `postgres` continua
// fazendo bypass; com FORCE ate o owner respeitaria RLS e quebraria o app.
// Sem nenhuma policy, RLS nega tudo por padrao pra quem nao bypassa (anon).
//
// Idempotente: so mexe nas tabelas que ainda nao tem RLS.
//
// Uso: pnpm --filter @concilia/db migrate:rls

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  const semRls = await sql<Array<{ tabela: string }>>`
    SELECT c.relname AS tabela
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
    ORDER BY c.relname
  `;
  console.log(`[1] ${semRls.length} tabelas public SEM RLS`);

  let ok = 0;
  for (const { tabela } of semRls) {
    await sql.unsafe(`ALTER TABLE public."${tabela}" ENABLE ROW LEVEL SECURITY`);
    ok++;
    if (ok % 20 === 0) console.log(`    ${ok}/${semRls.length}...`);
  }
  console.log(`[2] RLS habilitado (deny-all) em ${ok} tabelas`);

  const [resumo] = await sql<Array<{ total: number; com_rls: number }>>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE c.relrowsecurity)::int AS com_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  `;
  console.log(`[3] Resultado: ${resumo.com_rls}/${resumo.total} tabelas com RLS`);
  console.log('\nConcluido. Rode o Security Advisor de novo (Rerun linter).');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
