// Tabela de conversões: como cada insumo é vendido (fardo 30x1kg, caixa
// 12x1L, balde 14,5kg...) e quanto a embalagem contém na unidade de estoque.
//
// É o dicionário que faltava entre "quero 2 fardos" e "cotação em kg" — sem
// ele, 2 fardos viraram 2 kg no pedido de arroz. Fontes: NOTA (extraído das
// próprias notas fiscais), WEB (verificado no atacado), DONO (informado).

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('[1] Criando produto_embalagem...');
  await sql`
    CREATE TABLE IF NOT EXISTS produto_embalagem (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
      nome varchar(80) NOT NULL,
      qtd_na_unidade_estoque numeric(14,4) NOT NULL,
      padrao boolean NOT NULL DEFAULT false,
      fonte varchar(10) NOT NULL DEFAULT 'DONO',
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_prod_emb UNIQUE (produto_id, nome)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prod_emb_produto ON produto_embalagem (filial_id, produto_id)`;
  await sql`ALTER TABLE produto_embalagem ENABLE ROW LEVEL SECURITY`;
  console.log('OK.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
