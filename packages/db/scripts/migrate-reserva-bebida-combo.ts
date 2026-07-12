// Adiciona reserva.bebida_combo_qtd — quantidade do combo de cerveja
// (long neck=10, 600ml=6) quando a bebida pré-pedida vem do catálogo real
// do Consumer. Idempotente. Uso: pnpm --filter @concilia/db migrate:reserva-bebida-combo

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER reserva ADD bebida_combo_qtd... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS bebida_combo_qtd integer`;
  console.log('OK');
  await sql.end();
  console.log('Migration reserva-bebida-combo concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
