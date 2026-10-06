// Adiciona filial.comanda_so_cpf — true = a loja identifica a comanda só pelo
// CPF (não pede WhatsApp; comanda nova exige CPF); false (padrão) = CPF ou WhatsApp.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:comanda-so-cpf
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS comanda_so_cpf boolean NOT NULL DEFAULT false`;
  console.log('OK: filial.comanda_so_cpf pronta (default false)');
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
