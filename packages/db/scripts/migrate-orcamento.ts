// Cria a tabela orcamento_evento (orçamentos de eventos/grupos). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:orcamento

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  CREATE TABLE orcamento_evento... ');
  await sql`
    CREATE TABLE IF NOT EXISTS orcamento_evento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      numero serial,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      local varchar(100),
      cliente_nome varchar(200) NOT NULL,
      cliente_telefone varchar(30),
      data_evento date NOT NULL,
      hora varchar(5),
      pessoas integer NOT NULL DEFAULT 1,
      valor_pessoa numeric(10,2),
      pratos jsonb NOT NULL DEFAULT '[]'::jsonb,
      sobremesa_incluida boolean NOT NULL DEFAULT false,
      sobremesa_descricao text,
      taxa_espaco numeric(10,2),
      taxa_exclusividade numeric(10,2),
      observacoes text,
      condicoes text,
      valido_ate date,
      status varchar(20) NOT NULL DEFAULT 'aberto',
      criado_por varchar(160),
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS orcamento_evento_filial_data_idx ON orcamento_evento (filial_id, data_evento)`;
  await sql`CREATE INDEX IF NOT EXISTS orcamento_evento_filial_criado_idx ON orcamento_evento (filial_id, criado_em)`;
  console.log('OK');
  await sql.end();
  console.log('Migration orcamento concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
