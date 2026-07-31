// Adiciona reserva.lembrete_confirmacao_em e reserva.confirmada_cliente_em.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:reserva-lembrete

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER reserva ADD lembrete_confirmacao_em / confirmada_cliente_em... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS lembrete_confirmacao_em timestamptz`;
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS confirmada_cliente_em timestamptz`;
  console.log('OK');
  await sql.end();
  console.log('Migration reserva-lembrete concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
