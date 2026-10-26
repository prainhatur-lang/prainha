// Opção de mandar (ou não) o ponto em aberto no resumo diário do WhatsApp
// (relatorio_diario_config.ponto_aberto, padrão: manda).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:relatorio-ponto-aberto

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(
    `ALTER TABLE relatorio_diario_config ADD COLUMN IF NOT EXISTS ponto_aberto boolean NOT NULL DEFAULT true`,
  );
  console.log('[ok] relatorio_diario_config.ponto_aberto pronta');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
