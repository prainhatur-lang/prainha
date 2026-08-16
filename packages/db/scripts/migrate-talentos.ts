// Banco de talentos: tabela + RLS (regra da casa: toda CREATE TABLE nova
// termina com ENABLE ROW LEVEL SECURITY). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:talentos

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  process.stdout.write('CREATE TABLE talento... ');
  await sql`
    CREATE TABLE IF NOT EXISTS talento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cpf varchar(11) NOT NULL UNIQUE,
      nome varchar(200) NOT NULL,
      whatsapp varchar(20) NOT NULL,
      endereco text,
      funcoes jsonb NOT NULL,
      experiencia text,
      status varchar(20) NOT NULL DEFAULT 'novo',
      origem varchar(30) NOT NULL DEFAULT 'nina-whatsapp',
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log('OK');
  process.stdout.write('idx status... ');
  await sql`CREATE INDEX IF NOT EXISTS idx_talento_status ON talento (status)`;
  console.log('OK');
  process.stdout.write('RLS... ');
  await sql`ALTER TABLE talento ENABLE ROW LEVEL SECURITY`;
  console.log('OK');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
