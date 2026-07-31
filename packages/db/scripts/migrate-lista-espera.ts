// Cria a tabela lista_espera (recepcao). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:lista-espera

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  CREATE TABLE lista_espera... ');
  await sql`
    CREATE TABLE IF NOT EXISTS lista_espera (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nome varchar(200) NOT NULL,
      telefone varchar(30),
      pessoas integer NOT NULL DEFAULT 1,
      status varchar(20) NOT NULL DEFAULT 'aguardando',
      area varchar(100),
      observacao text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      chamado_em timestamptz,
      sentado_em timestamptz,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_lista_espera_filial_status ON lista_espera (filial_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_lista_espera_criado ON lista_espera (criado_em)`;
  console.log('OK');
  await sql.end();
  console.log('Migration lista-espera concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
