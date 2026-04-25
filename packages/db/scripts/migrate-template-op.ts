// Cria tabelas template_op + template_op_entrada + template_op_saida.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('[1] Criando template_op...');
  await sql`
    CREATE TABLE IF NOT EXISTS template_op (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nome varchar(200) NOT NULL,
      descricao_padrao varchar(200),
      observacao text,
      ativo boolean NOT NULL DEFAULT true,
      vezes_usado integer NOT NULL DEFAULT 0,
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_tpl_op_nome UNIQUE (filial_id, nome)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tpl_op_ativo ON template_op (filial_id, ativo)`;
  console.log('  OK');

  console.log('[2] Criando template_op_entrada...');
  await sql`
    CREATE TABLE IF NOT EXISTS template_op_entrada (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      template_id uuid NOT NULL REFERENCES template_op(id) ON DELETE CASCADE,
      produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE RESTRICT,
      quantidade_padrao numeric(14, 4) NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tpl_entrada_tpl ON template_op_entrada (template_id)`;
  console.log('  OK');

  console.log('[3] Criando template_op_saida...');
  await sql`
    CREATE TABLE IF NOT EXISTS template_op_saida (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      template_id uuid NOT NULL REFERENCES template_op(id) ON DELETE CASCADE,
      tipo varchar(10) NOT NULL DEFAULT 'PRODUTO',
      produto_id uuid REFERENCES produto(id) ON DELETE RESTRICT,
      quantidade_padrao numeric(14, 4) NOT NULL,
      peso_relativo numeric(8, 4) NOT NULL DEFAULT 1,
      observacao text
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tpl_saida_tpl ON template_op_saida (template_id)`;
  console.log('  OK');

  await sql.end();
  console.log('\nMigration template_op aplicada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
