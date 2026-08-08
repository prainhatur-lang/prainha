// Aceite público + entrada via Pix no orcamento_evento: token do link,
// registro do aceite e campos do pagamento Cielo. Backfill de token pros
// orçamentos existentes. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:orcamento-aceite

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER TABLE orcamento_evento (aceite + pix)... ');
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS entrada_valor numeric(10,2)`;
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS aceite_token text`;
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS aceite_em timestamptz`;
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS aceite_nome varchar(200)`;
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS aceite_ip varchar(64)`;
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS pagamento_status varchar(20)`;
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS pagamento_id varchar(50)`;
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS pagamento_qrcode text`;
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS pagamento_qrcode_img text`;
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS pago_em timestamptz`;
  console.log('OK');

  process.stdout.write('  Backfill aceite_token... ');
  // sha256 de uuid+clock = 64 hex, mesmo tamanho do avaliacaoToken.
  const r = await sql`
    UPDATE orcamento_evento
    SET aceite_token = encode(sha256((gen_random_uuid()::text || clock_timestamp()::text)::bytea), 'hex')
    WHERE aceite_token IS NULL
  `;
  console.log(`OK (${r.count} linhas)`);

  process.stdout.write('  UNIQUE aceite_token... ');
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS orcamento_evento_aceite_token_uq ON orcamento_evento (aceite_token)`;
  console.log('OK');

  await sql.end();
  console.log('Migration orcamento-aceite concluida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
