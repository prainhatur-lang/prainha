// Promocao dobrada (chope dobrado): paga 1 e leva 2; o 2o fica de vale na
// conta da loja ate o garcom soltar. Coluna do produto que desce pra loja
// pelo /api/loja/catalogo-nuvem (dobrado_vale).
//
// Uso: pnpm --filter @concilia/db migrate:produto-dobrado-vale

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  process.stdout.write('  produto.dobrado_vale... ');
  await sql`ALTER TABLE produto ADD COLUMN IF NOT EXISTS dobrado_vale boolean NOT NULL DEFAULT false`;
  console.log('OK');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
