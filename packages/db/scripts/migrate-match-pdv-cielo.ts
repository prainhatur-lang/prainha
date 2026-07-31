// Cria tabela match_pdv_cielo (matches persistidos PDV<->Cielo).

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('Criando tabela match_pdv_cielo...');
  await sql`
    CREATE TABLE IF NOT EXISTS match_pdv_cielo (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      pagamento_id uuid NOT NULL UNIQUE REFERENCES pagamento(id) ON DELETE CASCADE,
      venda_adquirente_id uuid NOT NULL UNIQUE,
      nivel_match numeric(2, 0) NOT NULL,
      auto_revogavel_ate timestamptz,
      criado_por varchar(50) NOT NULL DEFAULT 'AUTO',
      diff_valor numeric(14, 2),
      observacao text,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS match_pdv_cielo_filial_idx ON match_pdv_cielo (filial_id)`;
  await sql`
    CREATE INDEX IF NOT EXISTS match_pdv_cielo_revogaveis_idx
      ON match_pdv_cielo (filial_id)
     WHERE auto_revogavel_ate IS NOT NULL
  `;
  console.log('OK');

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
