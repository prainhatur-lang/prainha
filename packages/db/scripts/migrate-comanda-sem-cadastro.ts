// Adiciona filial.comanda_sem_cadastro — true = a loja abre comanda e lança
// item sem nome/CPF/WhatsApp; false (padrão) = comanda só com dono.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:comanda-sem-cadastro
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS comanda_sem_cadastro boolean NOT NULL DEFAULT false`;
  console.log('OK: filial.comanda_sem_cadastro pronta (default false)');
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
