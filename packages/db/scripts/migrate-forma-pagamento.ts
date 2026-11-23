// Como o fornecedor recebe (boleto | pix) + override por conta + vínculo de
// "mesma dívida" (boleto × Pix). 23/11/2026. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS forma_pagamento varchar(10)`);
  console.log('[ok] fornecedor.forma_pagamento');
  await sql.unsafe(`ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS forma_pagamento varchar(10)`);
  await sql.unsafe(`ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS mesma_divida_id uuid`);
  await sql.unsafe(`ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS gemea_conferida_em timestamptz`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS conta_pagar_mesma_divida_idx ON conta_pagar (mesma_divida_id) WHERE mesma_divida_id IS NOT NULL`);
  console.log('[ok] conta_pagar.forma_pagamento, mesma_divida_id, gemea_conferida_em');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
