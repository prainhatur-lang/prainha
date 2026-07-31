// Adiciona reserva.bebida_codigo_pdv e reserva.bebida_lancamento_status —
// lançamento automático da bebida pré-pedida na comanda quando o cliente
// senta (F2). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:reserva-bebida-lancamento

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER reserva ADD bebida_codigo_pdv... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS bebida_codigo_pdv integer`;
  console.log('OK');

  process.stdout.write('  ALTER reserva ADD bebida_lancamento_status... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS bebida_lancamento_status varchar(20)`;
  console.log('OK');

  await sql.end();
  console.log('Migration reserva-bebida-lancamento concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
