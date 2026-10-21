// Reservas do dia (20/10/2026): quem recebe às 07:00 a lista de reservas de hoje
// de cada casa (chefe de cozinha, gerente de salão, bar) — relatorio_diario_config.destinos_reservas.
// NULL = ninguém cadastrado.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:destinos-reservas

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE relatorio_diario_config ADD COLUMN IF NOT EXISTS destinos_reservas jsonb`);
  console.log('[ok] relatorio_diario_config.destinos_reservas');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
