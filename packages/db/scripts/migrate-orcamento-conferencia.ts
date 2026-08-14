// Conferência pós-evento do orçamento: coluna jsonb com o resultado da
// comparação cobrado × consumido (comandas do PDV do dia do evento).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:orcamento-conferencia

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  process.stdout.write('ALTER orcamento_evento ADD conferencia... ');
  await sql`ALTER TABLE orcamento_evento ADD COLUMN IF NOT EXISTS conferencia jsonb`;
  console.log('OK');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
