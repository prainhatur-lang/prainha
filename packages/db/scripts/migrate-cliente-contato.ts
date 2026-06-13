// Cria a tabela cliente_contato (contatos importados, ex: Tagme). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:cliente-contato

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  CREATE TABLE cliente_contato... ');
  await sql`
    CREATE TABLE IF NOT EXISTS cliente_contato (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nome varchar(200) NOT NULL,
      sobrenome varchar(200),
      data_aniversario varchar(10),
      genero varchar(20),
      telefone varchar(30),
      email varchar(200),
      pontos_fidelidade integer DEFAULT 0,
      reservas_historico integer DEFAULT 0,
      filas_espera_historico integer DEFAULT 0,
      detalhes text,
      origem varchar(20) NOT NULL DEFAULT 'tagme',
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_cliente_contato_filial ON cliente_contato (filial_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cliente_contato_fone ON cliente_contato (filial_id, telefone)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cliente_contato_email ON cliente_contato (filial_id, email)`;
  console.log('OK');
  await sql.end();
  console.log('Migration cliente-contato concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
