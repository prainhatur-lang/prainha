// Formação de preço da Lelis (01/11/2026): revenda_produto + revenda_config.
// Ver packages/db/src/schema/revenda.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:revenda-preco

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS revenda_produto (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      chave varchar(80) NOT NULL,
      ean varchar(14),
      codigo_fornecedor varchar(60),
      fornecedor_nome text,
      descricao text NOT NULL,
      ncm varchar(8),
      cest varchar(7),
      unidade varchar(6) NOT NULL DEFAULT 'UN',
      custo_unit numeric(14,4) NOT NULL DEFAULT 0,
      pct_ipi numeric(7,4) NOT NULL DEFAULT 0,
      aliq_origem numeric(5,2),
      pct_carga numeric(7,4),
      carga_com_ipi boolean NOT NULL DEFAULT true,
      frete_unit numeric(14,4) NOT NULL DEFAULT 0,
      pct_operacional numeric(7,4),
      pct_margem numeric(7,4),
      pct_impostos_venda numeric(7,4),
      preco_manual numeric(14,2),
      ultima_nota_chave varchar(44),
      ultima_compra_em date,
      ativo boolean NOT NULL DEFAULT true,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_por text,
      CONSTRAINT uq_revenda_produto_chave UNIQUE (filial_id, chave)
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_revenda_produto_filial ON revenda_produto (filial_id, ativo)`);
  await sql.unsafe(`ALTER TABLE revenda_produto ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] revenda_produto (+ RLS)');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS revenda_config (
      filial_id uuid PRIMARY KEY REFERENCES filial(id) ON DELETE CASCADE,
      pct_operacional numeric(7,4) NOT NULL DEFAULT 10,
      pct_margem numeric(7,4) NOT NULL DEFAULT 15,
      pct_impostos_venda numeric(7,4) NOT NULL DEFAULT 0,
      fiscal jsonb NOT NULL DEFAULT '{}'::jsonb,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_por text
    )`);
  await sql.unsafe(`ALTER TABLE revenda_config ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] revenda_config (+ RLS)');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
