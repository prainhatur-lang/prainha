// Contas de cliente do Concilia SaaS (cadastro sozinho + teste de 15 dias).
// Uso: pnpm --filter @concilia/db migrate:saas-conta

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(n: string, f: () => Promise<T>) {
  process.stdout.write(`  ${n}... `);
  const r = await f();
  console.log('OK');
  return r;
}

async function main() {
  await run('saas_conta', () =>
    sql`
      CREATE TABLE IF NOT EXISTS saas_conta (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        documento varchar(14) NOT NULL,
        tipo_documento varchar(4) NOT NULL,
        razao_social varchar(200),
        nome_fantasia varchar(200) NOT NULL,
        responsavel varchar(200) NOT NULL,
        email varchar(200) NOT NULL,
        whatsapp varchar(20) NOT NULL,
        cidade varchar(120),
        uf varchar(2),
        plano_desejado varchar(30),
        status varchar(24) NOT NULL DEFAULT 'teste',
        teste_inicio date NOT NULL,
        teste_fim date NOT NULL,
        interessado_id uuid,
        organizacao_id uuid,
        filial_id uuid,
        origem varchar(40),
        observacao text,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT saas_conta_documento_uq UNIQUE (documento)
      )`,
  );
  await run('idx', () => sql`CREATE INDEX IF NOT EXISTS saas_conta_criado_idx ON saas_conta (criado_em)`);
  await run('RLS', () => sql.unsafe(`ALTER TABLE saas_conta ENABLE ROW LEVEL SECURITY`));
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
