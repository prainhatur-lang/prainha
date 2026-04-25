// Cria tabela match_pdv_banco (matches persistidos entre pagamento canal=DIRETO
// e lancamento_banco).

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('Criando tabela match_pdv_banco...');
  await sql`
    CREATE TABLE IF NOT EXISTS match_pdv_banco (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      pagamento_id uuid NOT NULL UNIQUE REFERENCES pagamento(id) ON DELETE CASCADE,
      lancamento_banco_id uuid NOT NULL UNIQUE,
      nivel_match numeric(2, 0) NOT NULL,
      criado_por varchar(50) NOT NULL DEFAULT 'AUTO',
      auto_revogavel_ate timestamptz,
      observacao text,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS match_pdv_banco_filial_idx ON match_pdv_banco (filial_id)`;
  console.log('OK');

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
