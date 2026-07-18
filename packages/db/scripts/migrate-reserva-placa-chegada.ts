// Adiciona reserva.placa_chegada_em — timestamp de quando o agente-patio
// detectou a placa do veículo entrando (LPR bateu com placaVeiculo), pra
// avisar a recepção com som na hora. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:reserva-placa-chegada

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER reserva ADD placa_chegada_em... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS placa_chegada_em timestamptz`;
  console.log('OK');

  await sql.end();
  console.log('Migration reserva-placa-chegada concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
