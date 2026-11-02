// ifood_homolog_log: chamadas à API do iFood feitas na homologação (loja de
// teste) — vira o arquivo de logs do chamado do Shipping (02/11/2026).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:ifood-homolog-log

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ifood_homolog_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid REFERENCES filial(id) ON DELETE CASCADE,
      modulo varchar(20) NOT NULL,
      quando timestamptz NOT NULL,
      metodo varchar(8) NOT NULL,
      caminho text NOT NULL,
      status integer NOT NULL,
      ms integer NOT NULL,
      tentativa integer NOT NULL DEFAULT 0,
      pedido jsonb,
      resposta text
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ifood_homolog_log ON ifood_homolog_log (filial_id, modulo, quando)`);
  await sql.unsafe(`ALTER TABLE ifood_homolog_log ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] ifood_homolog_log');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
