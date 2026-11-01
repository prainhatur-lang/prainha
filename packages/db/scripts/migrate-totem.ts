// totem_item: cardápio do TOTEM de autoatendimento (dono, 01/11/2026) — tela
// de toque na recepção da Prainha Bar onde quem espera mesa pede e paga
// sozinho. Cardápio resumido e SÓ dele: água de coco, refri, long neck,
// drinks, dose. Cada linha liga uma variante (código do PDV) a um grupo da
// tela ('cerveja' | 'drinks' | 'sem_alcool').
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:totem

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS totem_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo integer NOT NULL,
      grupo text NOT NULL,
      ordem integer NOT NULL DEFAULT 0,
      ativo boolean NOT NULL DEFAULT true,
      atualizado_por text,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      UNIQUE (filial_id, codigo)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_totem_item_filial ON totem_item (filial_id)`);
  await sql.unsafe(`ALTER TABLE totem_item ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] totem_item pronta');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
