// Adiciona pagamento.forma_efetiva + pagamento.bandeira_efetiva.
// Setadas quando divergencia de categoria e aceita pelo user.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('Adicionando pagamento.forma_efetiva...');
  await sql`ALTER TABLE pagamento ADD COLUMN IF NOT EXISTS forma_efetiva varchar(255)`;
  console.log('Adicionando pagamento.bandeira_efetiva...');
  await sql`ALTER TABLE pagamento ADD COLUMN IF NOT EXISTS bandeira_efetiva varchar(50)`;
  console.log('OK');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
