// Adiciona filial.adquirente_maquininha — qual adquirente a maquininha do
// garçom usa nesta filial: 'cielo' (LIO) ou 'rede' (Laranjinha Smart).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:adquirente-maquininha
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS adquirente_maquininha text DEFAULT 'cielo'`;
  await sql`UPDATE filial SET adquirente_maquininha = 'cielo' WHERE adquirente_maquininha IS NULL`;
  console.log('OK: filial.adquirente_maquininha pronta (default cielo)');
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
