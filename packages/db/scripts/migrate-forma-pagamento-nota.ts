// Forma de pagamento informada NA ENTRADA da nota/recibo (boleto | pix) +
// chave Pix confirmada. Dono 23/11/2026. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS forma_pagamento varchar(10)`);
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS pix_chave_confirmada varchar(140)`);
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS forma_informada_em timestamptz`);
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS forma_informada_por uuid`);
  console.log('[ok] nota_compra.forma_pagamento, pix_chave_confirmada, forma_informada_em/por');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
