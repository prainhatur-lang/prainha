// Espelho das ETIQUETAS do Consumer = a categoria real do cardápio.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:produto-etiqueta

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  process.stdout.write('produto_etiqueta... ');
  await sql`
    CREATE TABLE IF NOT EXISTS produto_etiqueta (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo_externo integer NOT NULL,
      nome varchar(100) NOT NULL,
      sincronizado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_produto_etiqueta_filial_codigo UNIQUE (filial_id, codigo_externo)
    )
  `;
  await sql`ALTER TABLE produto_etiqueta ENABLE ROW LEVEL SECURITY`;
  console.log('OK');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
