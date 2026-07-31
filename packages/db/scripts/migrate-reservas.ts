// Cria a tabela reserva (setor de reservas). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:reservas

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL, { prepare: false });

async function main() {
  process.stdout.write('  CREATE TABLE reserva... ');
  await sql`
    CREATE TABLE IF NOT EXISTS reserva (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      cliente_nome varchar(200) NOT NULL,
      cliente_telefone varchar(30),
      pessoas integer NOT NULL DEFAULT 1,
      data date NOT NULL,
      hora varchar(5) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'pendente',
      area varchar(100),
      mesa varchar(20),
      canal varchar(30) NOT NULL DEFAULT 'outro',
      observacao text,
      origem_externa varchar(30),
      id_externo varchar(100),
      criado_em timestamp with time zone NOT NULL DEFAULT now(),
      atualizado_em timestamp with time zone NOT NULL DEFAULT now()
    )
  `;
  console.log('OK');

  process.stdout.write('  INDEX + UNIQUE... ');
  await sql`CREATE INDEX IF NOT EXISTS reserva_filial_data_idx ON reserva (filial_id, data)`;
  await sql`
    DO $$ BEGIN
      ALTER TABLE reserva ADD CONSTRAINT reserva_externa_unique
        UNIQUE (filial_id, origem_externa, id_externo);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `;
  console.log('OK');

  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
