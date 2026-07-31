// Adiciona tokenAcesso em colaborador (acesso ao painel pessoal) e cria
// tabela ordem_producao_foto (fotos de entrada/saída pra auditoria).

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('[1] Adicionando colaborador.token_acesso...');
  await sql`
    ALTER TABLE colaborador
    ADD COLUMN IF NOT EXISTS token_acesso varchar(64) UNIQUE
  `;
  console.log('  OK');

  console.log('[2] Criando ordem_producao_foto...');
  await sql`
    CREATE TABLE IF NOT EXISTS ordem_producao_foto (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      ordem_producao_id uuid NOT NULL REFERENCES ordem_producao(id) ON DELETE CASCADE,
      tipo varchar(10) NOT NULL,
      storage_path text NOT NULL,
      url text,
      observacao text,
      enviada_por_token varchar(64),
      enviada_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_op_foto_op
    ON ordem_producao_foto (ordem_producao_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_op_foto_tipo
    ON ordem_producao_foto (ordem_producao_id, tipo)
  `;
  console.log('  OK');

  await sql.end();
  console.log('\nMigration aplicada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
