// Cria cliente_documento: cadastro de cliente compartilhado entre as filiais.
// Guarda o HASH do CPF, nunca o CPF. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:cliente-documento

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS cliente_documento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      cpf_hash varchar(64) NOT NULL,
      telefone_fim varchar(8),
      nome text NOT NULL,
      origem varchar(20) NOT NULL DEFAULT 'manual',
      filial_id uuid REFERENCES filial(id) ON DELETE SET NULL,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )`;
  // um registro por CPF dentro da organizacao — o upsert depende disto
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS cliente_documento_org_cpf_uk
    ON cliente_documento (organizacao_id, cpf_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS cliente_documento_org_tel_idx
    ON cliente_documento (organizacao_id, telefone_fim)`;
  await sql`ALTER TABLE cliente_documento ENABLE ROW LEVEL SECURITY`;

  const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM cliente_documento`;
  console.log(`ok — cliente_documento pronta (${n} registros)`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
