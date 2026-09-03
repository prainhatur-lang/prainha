// Adiciona filial.adquirente_online — adquirente da cobrança ONLINE (Pix/cartão
// nas reservas, orçamentos, delivery, pagar-mesa): 'cielo' | 'rede' (e.Rede).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:adquirente-online
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS adquirente_online text DEFAULT 'cielo'`;
  await sql`UPDATE filial SET adquirente_online = 'cielo' WHERE adquirente_online IS NULL`;
  console.log('OK: filial.adquirente_online pronta (default cielo)');
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
