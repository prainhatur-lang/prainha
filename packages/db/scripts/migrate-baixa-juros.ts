// Adiciona juros/multa na baixa de conta a pagar: pagamento atrasado carrega
// juros, que ficam SEPARADOS do principal (a conta quita pelo principal).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:baixa-juros

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE conta_pagar_baixa ADD COLUMN IF NOT EXISTS juros numeric(14,2)`;
  console.log('coluna juros OK');
  // RLS da tabela já está ENABLE (migrate-conta-pagar-baixa)
  await sql.end();
  console.log('Migration concluida.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
