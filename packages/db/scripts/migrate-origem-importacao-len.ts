// Alarga nota_compra.origem_importacao de varchar(20) para varchar(40).
// O marcador de ciência 'SEFAZ_DFE_RESUMO_CIENTE' tem 23 chars e estourava o
// varchar(20) ("value too long for type character varying(20)"). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:origem-importacao-len

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER nota_compra.origem_importacao -> varchar(40)... ');
  await sql`ALTER TABLE nota_compra ALTER COLUMN origem_importacao TYPE varchar(40)`;
  console.log('OK');
  await sql.end();
  console.log('Migration origem-importacao-len concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
