// CPF do cliente na reserva (Nina pede CPF em vez de nome; nome vem do
// cadastro). Idempotente. Uso: pnpm --filter @concilia/db migrate:reserva-cpf

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  process.stdout.write('ALTER reserva ADD cliente_cpf... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS cliente_cpf varchar(14)`;
  console.log('OK');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
