// Comprovantes da lotérica (/folha-equipe/comprovantes): foto do depósito do
// 10% que dá baixa na conta FOLHA. Ver packages/db/src/schema/comprovante-loterica.ts.
// A foto fica no bucket privado `extratos-fechamento` (já existe), pasta `loterica/`.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:comprovante-loterica

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS comprovante_loterica (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid REFERENCES filial(id) ON DELETE SET NULL,
      folha_semana_id uuid,
      fornecedor_id uuid,
      conta_pagar_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      nome_lido text,
      valor numeric(14,2),
      data_pagamento date,
      hora varchar(8),
      autenticacao varchar(60),
      lido jsonb,
      status varchar(12) NOT NULL DEFAULT 'ERRO',
      erro text,
      nome_original text NOT NULL,
      storage_path text NOT NULL UNIQUE,
      content_type varchar(120),
      tamanho_bytes integer,
      enviado_por uuid REFERENCES usuario(id),
      enviado_em timestamptz NOT NULL DEFAULT now(),
      baixado_em timestamptz,
      baixado_por uuid REFERENCES usuario(id),
      excluido_em timestamptz,
      excluido_por uuid REFERENCES usuario(id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_comprovante_loterica_filial_data ON comprovante_loterica (filial_id, data_pagamento)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_comprovante_loterica_autenticacao ON comprovante_loterica (autenticacao)`);
  await sql.unsafe(`ALTER TABLE comprovante_loterica ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] comprovante_loterica pronta (RLS ligado)');
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
