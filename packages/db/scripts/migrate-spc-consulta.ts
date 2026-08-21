// Cache das consultas do SPC na nuvem.
//
// A consulta é PAGA por CPF (conta da CDL Aracaju, produto 11 = CONFIRME PF).
// Então nada de consultar duas vezes o mesmo documento: a chave é o sha256 do
// CPF só com dígitos — MESMO hash que o vendas-local já usa na tabela
// spc_cache da loja, pra um dia as duas pontas dividirem o mesmo cache.
//
// Guarda o JSON cru (`bruto`) porque cada produto do SPC devolve um formato e
// os campos são catados por varredura — se amanhã precisar de um campo novo,
// dá pra reprocessar sem pagar de novo.
//
// nome NULL = "já consultamos e o SPC não devolveu nome útil". Guardar o
// negativo é o que impede pagar de novo por um CPF que não tem cadastro lá.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:spc-consulta

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
  console.log('[1] tabela spc_consulta');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS spc_consulta (
      cpf_hash      text PRIMARY KEY,
      nome          text,
      nascimento    date,
      mae           text,
      email         text,
      telefone      varchar(15),
      endereco      text,
      numero        varchar(20),
      bairro        text,
      cidade        text,
      uf            varchar(2),
      cep           varchar(8),
      bruto         jsonb,
      consultado_em timestamptz NOT NULL DEFAULT now(),
      consultado_por uuid,
      filial_id     uuid REFERENCES filial(id) ON DELETE SET NULL
    )
  `);

  // Coluna que nasceu depois da tabela (o produto 11 devolve e-mail).
  await run('coluna email', () =>
    sql`ALTER TABLE spc_consulta ADD COLUMN IF NOT EXISTS email text`,
  );

  await run('index por data', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_spc_consulta_data ON spc_consulta (consultado_em DESC)`,
  );

  // Tabela nova SEMPRE com RLS (ENABLE, nunca FORCE): sem isso a anon key do
  // Supabase lê a tabela inteira via PostgREST — e aqui tem dado pessoal.
  console.log('[2] RLS');
  await run('enable row level security', () =>
    sql`ALTER TABLE spc_consulta ENABLE ROW LEVEL SECURITY`,
  );

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
