// ifood_entrega: troca de endereço pedida pelo cliente (evento DAR) e conferência
// do código de coleta — os dois pedaços que faltavam pra homologar o Shipping
// (02/11/2026). ifood_nuvem_evento.metadata guarda o que vem junto no evento.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:ifood-entrega-endereco

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE ifood_entrega
      ADD COLUMN IF NOT EXISTS troca_endereco jsonb,
      ADD COLUMN IF NOT EXISTS troca_endereco_status varchar(12),
      ADD COLUMN IF NOT EXISTS troca_endereco_respondida_em timestamptz,
      ADD COLUMN IF NOT EXISTS troca_endereco_respondida_por uuid,
      ADD COLUMN IF NOT EXISTS coleta_conferida_em timestamptz,
      ADD COLUMN IF NOT EXISTS coleta_conferida_por uuid
  `);
  await sql.unsafe(`ALTER TABLE ifood_nuvem_evento ADD COLUMN IF NOT EXISTS metadata jsonb`);
  console.log('[ok] ifood_entrega (troca de endereço + coleta) e ifood_nuvem_evento.metadata');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
