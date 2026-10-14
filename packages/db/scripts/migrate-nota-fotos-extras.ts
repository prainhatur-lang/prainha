// nota_compra.fotos_extras: pedido sem nota em várias fotos. Alguns fornecedores
// (hortifruti) entregam um pedido em 3 notinhas; o dono pediu (14/10/2026) que
// as 3 fotos virem UMA entrada. A primeira foto continua em xml_storage_path;
// as demais ficam aqui, na ordem.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:nota-fotos-extras

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS fotos_extras text[]`);
  console.log('ok: nota_compra.fotos_extras');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
