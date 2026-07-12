// Adiciona reserva.bebida_pedido, placa_veiculo, bebida_confirmada — pré-pedido
// de bebida antecipado (F1). Idempotente. Uso: pnpm --filter @concilia/db migrate:reserva-pre-pedido

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER reserva ADD bebida_pedido... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS bebida_pedido varchar(100)`;
  console.log('OK');

  process.stdout.write('  ALTER reserva ADD placa_veiculo... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS placa_veiculo varchar(10)`;
  console.log('OK');

  process.stdout.write('  ALTER reserva ADD bebida_confirmada... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS bebida_confirmada boolean`;
  console.log('OK');

  await sql.end();
  console.log('Migration reserva-pre-pedido concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
