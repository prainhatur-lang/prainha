// Lelis (01/11/2026): tributação de entrada no item da nota de compra, tributação
// de saída no produto, estoque (revenda_movimento) e contas a receber (revenda_receber).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:lelis-entrada

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE nota_compra_item
      ADD COLUMN IF NOT EXISTS origem_merc varchar(1),
      ADD COLUMN IF NOT EXISTS cst_icms varchar(4),
      ADD COLUMN IF NOT EXISTS valor_bc_st numeric(14,2),
      ADD COLUMN IF NOT EXISTS valor_icms_st numeric(14,2),
      ADD COLUMN IF NOT EXISTS valor_icms_st_ret numeric(14,2),
      ADD COLUMN IF NOT EXISTS cst_pis varchar(2),
      ADD COLUMN IF NOT EXISTS cst_cofins varchar(2)`);
  console.log('[ok] nota_compra_item: tributação de entrada');

  await sql.unsafe(`
    ALTER TABLE revenda_produto
      ADD COLUMN IF NOT EXISTS trib_icms varchar(10),
      ADD COLUMN IF NOT EXISTS cst_pis_saida varchar(2),
      ADD COLUMN IF NOT EXISTS trib_manual boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS cfop_entrada varchar(4),
      ADD COLUMN IF NOT EXISTS cst_icms_entrada varchar(4),
      ADD COLUMN IF NOT EXISTS cst_pis_entrada varchar(2),
      ADD COLUMN IF NOT EXISTS icms_st_unit numeric(14,4)`);
  console.log('[ok] revenda_produto: tributação de saída');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS revenda_movimento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      revenda_produto_id uuid NOT NULL REFERENCES revenda_produto(id) ON DELETE CASCADE,
      tipo varchar(16) NOT NULL,
      quantidade numeric(14,4) NOT NULL,
      custo_unit numeric(14,4),
      nota_compra_item_id uuid,
      nfe_emitida_id uuid,
      observacao text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      criado_por text
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_revenda_mov_prod ON revenda_movimento (filial_id, revenda_produto_id)`);
  // uma entrada por item de nota; uma saída/estorno por produto e nota de venda
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_revenda_mov_entrada ON revenda_movimento (nota_compra_item_id) WHERE tipo = 'ENTRADA_COMPRA'`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_revenda_mov_venda ON revenda_movimento (nfe_emitida_id, revenda_produto_id, tipo) WHERE nfe_emitida_id IS NOT NULL`);
  await sql.unsafe(`ALTER TABLE revenda_movimento ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] revenda_movimento (+ RLS)');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS revenda_receber (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nfe_emitida_id uuid,
      comprador_doc varchar(14),
      comprador_nome text,
      descricao text,
      parcela numeric(4,0) NOT NULL DEFAULT 1,
      total_parcelas numeric(4,0) NOT NULL DEFAULT 1,
      vencimento date NOT NULL,
      valor numeric(14,2) NOT NULL,
      forma_pagamento varchar(2),
      recebido_em date,
      valor_recebido numeric(14,2),
      recebido_por text,
      cancelado boolean NOT NULL DEFAULT false,
      criado_em timestamptz NOT NULL DEFAULT now(),
      criado_por text
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_revenda_receber_filial ON revenda_receber (filial_id, vencimento)`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_revenda_receber_parcela ON revenda_receber (nfe_emitida_id, parcela) WHERE nfe_emitida_id IS NOT NULL`);
  await sql.unsafe(`ALTER TABLE revenda_receber ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] revenda_receber (+ RLS)');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
