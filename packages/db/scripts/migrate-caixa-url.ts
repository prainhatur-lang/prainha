// Adiciona filial.caixa_url — URL pública da loja (Tailscale Funnel) pra a
// Conferência de Caixa do web falar com o vendas-local (assinado). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:caixa-url
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS caixa_url text`;
  console.log('OK: filial.caixa_url pronta');
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
