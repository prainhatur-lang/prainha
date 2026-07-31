// Cria tabela sugestao_cross_route (sugestoes geradas pelo engine cross-route).

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('Criando tabela sugestao_cross_route...');
  await sql`
    CREATE TABLE IF NOT EXISTS sugestao_cross_route (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      pagamento_id uuid NOT NULL UNIQUE REFERENCES pagamento(id) ON DELETE CASCADE,
      tipo varchar(30) NOT NULL,
      lancamento_banco_id uuid,
      venda_adquirente_id uuid,
      score numeric(2, 0) NOT NULL,
      motivo text,
      rejeitado_em timestamptz,
      rejeitado_por uuid,
      aceito_em timestamptz,
      aceito_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS sugestao_cross_route_filial_idx
      ON sugestao_cross_route (filial_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS sugestao_cross_route_abertas_idx
      ON sugestao_cross_route (filial_id)
     WHERE aceito_em IS NULL AND rejeitado_em IS NULL
  `;
  console.log('OK');

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
