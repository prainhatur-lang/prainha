// Aplica migration delta: ALTER certificado_filial ADD compartilhar_organizacao.
// Permite que 1 cert (geralmente da matriz) sirva pra todas filiais da mesma
// organizacao (mesmo CNPJ raiz).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cert-compartilhar

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER certificado_filial ADD compartilhar_organizacao... ');
  await sql`
    ALTER TABLE certificado_filial
    ADD COLUMN IF NOT EXISTS compartilhar_organizacao boolean NOT NULL DEFAULT false
  `;
  console.log('OK');

  console.log('\nMigration concluida.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
