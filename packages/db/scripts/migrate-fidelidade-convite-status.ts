// Cliente VIP — recibo do convite por WhatsApp:
//   · fidelidade_cartao: convite_wamid (id da mensagem na Meta),
//     convite_status (enviada/entregue/lida/erro), convite_status_em
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fidelidade-convite-status

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS convite_wamid varchar(200)`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS convite_status varchar(12)`;
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS convite_status_em timestamptz`;
  await sql`CREATE INDEX IF NOT EXISTS fidelidade_cartao_convite_wamid_idx ON fidelidade_cartao (convite_wamid) WHERE convite_wamid IS NOT NULL`;
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
