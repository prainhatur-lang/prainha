// Configurador de Pix por casa (pedido do dono 10/11/2026): por qual banco/
// adquirente cada casa recebe Pix — 'cielo' | 'rede' | 'sicredi' | 'inter' —
// e a chave Pix da conta (Sicredi/Inter). NULL = como sempre foi (Pix segue o
// adquirente de cada canal). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:pix-provedor
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS pix_provedor text`;
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS pix_chave text`;
  console.log('OK: filial.pix_provedor e filial.pix_chave prontas (NULL = como antes)');
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
