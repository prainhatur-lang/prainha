// Interessados do site público /conheca (funil de venda do Concilia SaaS).
// Uso: pnpm --filter @concilia/db migrate:saas-interessado

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
  await run('saas_interessado', () =>
    sql`
      CREATE TABLE IF NOT EXISTS saas_interessado (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nome varchar(200) NOT NULL,
        estabelecimento varchar(200),
        cidade varchar(120),
        whatsapp varchar(20) NOT NULL,
        email varchar(200),
        maquininhas integer,
        plano varchar(30),
        mensagem text,
        origem varchar(40),
        status varchar(20) NOT NULL DEFAULT 'novo',
        criado_em timestamptz NOT NULL DEFAULT now()
      )`,
  );
  await run('idx', () =>
    sql`CREATE INDEX IF NOT EXISTS saas_interessado_criado_idx ON saas_interessado (criado_em)`,
  );
  await run('RLS', () => sql.unsafe(`ALTER TABLE saas_interessado ENABLE ROW LEVEL SECURITY`));
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
