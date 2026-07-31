import { defineConfig } from 'drizzle-kit';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Carrega .env da raiz do monorepo (drizzle-kit roda em CJS, sem import.meta)
loadEnv({ path: resolve(process.cwd(), '../../.env') });

// Migrations devem usar a Session Pooler (porta 5432) ou Direct,
// pois Transaction Pooler nao suporta DDL com prepared statements.
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL_DIRECT nao definida. Crie um .env na raiz do monorepo.');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
