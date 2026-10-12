// Faturas de cartão de crédito (/financeiro/cartoes): cartao_fatura (o arquivo
// e o cabeçalho lido) e cartao_lancamento (uma linha por compra). Os arquivos
// ficam no bucket privado `extratos-fechamento`, pasta `cartoes/` (o bucket já
// existe — migrate:extrato-fechamento). Ver packages/db/src/schema/cartao-fatura.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cartao-fatura

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS cartao_fatura (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      banco varchar(60),
      cartao_final varchar(8),
      titular varchar(120),
      vencimento date,
      total numeric(14,2),
      soma_lida numeric(14,2),
      qtd_lancamentos integer NOT NULL DEFAULT 0,
      status varchar(12) NOT NULL DEFAULT 'ERRO',
      erro text,
      nome_original text NOT NULL,
      storage_path text NOT NULL UNIQUE,
      content_type varchar(120),
      tamanho_bytes integer,
      enviado_por uuid REFERENCES usuario(id),
      enviado_em timestamptz NOT NULL DEFAULT now(),
      excluido_em timestamptz,
      excluido_por uuid REFERENCES usuario(id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cartao_fatura_org_venc ON cartao_fatura (organizacao_id, vencimento)`);
  await sql.unsafe(`ALTER TABLE cartao_fatura ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] cartao_fatura pronta (RLS ligado)');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS cartao_lancamento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      fatura_id uuid NOT NULL REFERENCES cartao_fatura(id) ON DELETE CASCADE,
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      ordem integer NOT NULL DEFAULT 0,
      cartao_final varchar(8),
      data_compra date,
      estabelecimento text NOT NULL,
      parcela integer,
      total_parcelas integer,
      valor numeric(14,2) NOT NULL,
      categoria varchar(60),
      filial_id uuid REFERENCES filial(id) ON DELETE SET NULL
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cartao_lanc_fatura ON cartao_lancamento (fatura_id, ordem)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cartao_lanc_org_data ON cartao_lancamento (organizacao_id, data_compra)`);
  await sql.unsafe(`ALTER TABLE cartao_lancamento ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] cartao_lancamento pronta (RLS ligado)');

  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
