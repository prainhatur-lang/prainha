// Adiciona reserva.pagamento_status/valor/id/qrcode — taxa de reserva
// obrigatória (ex: Lounge) via Cielo Pix. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:reserva-pagamento

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER reserva ADD pagamento_status... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS pagamento_status varchar(20)`;
  console.log('OK');

  process.stdout.write('  ALTER reserva ADD pagamento_valor... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS pagamento_valor numeric(10,2)`;
  console.log('OK');

  process.stdout.write('  ALTER reserva ADD pagamento_id... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS pagamento_id varchar(50)`;
  console.log('OK');

  process.stdout.write('  ALTER reserva ADD pagamento_qrcode... ');
  await sql`ALTER TABLE reserva ADD COLUMN IF NOT EXISTS pagamento_qrcode text`;
  console.log('OK');

  await sql.end();
  console.log('Migration reserva-pagamento concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
