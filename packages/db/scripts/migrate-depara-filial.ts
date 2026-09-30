// DE/PARA de produto entre casas (transferência): tabela produto_depara_filial.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:depara-filial

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS produto_depara_filial (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      produto_origem_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
      filial_destino_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      produto_destino_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
      atualizado_por uuid,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_depara_origem_destino UNIQUE (produto_origem_id, filial_destino_id)
    )
  `;
  console.log('  produto_depara_filial OK');
  await sql`ALTER TABLE produto_depara_filial ENABLE ROW LEVEL SECURITY`;
  console.log('  RLS OK');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
