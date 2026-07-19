// Adiciona reserva.mesa_juntada — segunda mesa juntada lateralmente à
// mesa principal, pra caber um grupo maior que a capacidade de uma mesa só.
// Idempotente.
// Uso: pnpm --filter @concilia/db migrate:reserva-mesa-juntada

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER reserva ADD mesa_juntada... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS mesa_juntada varchar(20)`;
  console.log('OK');

  await sql.end();
  console.log('Migration reserva-mesa-juntada concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
