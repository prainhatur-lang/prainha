// Classificação por produto (hortifruti principalmente): cebola caixa 1/2/3,
// tomate verde/verdoso/maduro, batata pequena/média/grande.
//
// Sem isso, um fornecedor cota tomate maduro e outro cota verde pelo mesmo
// "Tomate" — os preços não são comparáveis e o vencedor sai errado.
// A classificação escolhida vai no item da cotação (cotacao_item.classificacao),
// então todo mundo cota exatamente a mesma coisa.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('[1] Criando produto_classificacao...');
  await sql`
    CREATE TABLE IF NOT EXISTS produto_classificacao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
      valor varchar(60) NOT NULL,
      ordem integer NOT NULL DEFAULT 0,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_prod_classif UNIQUE (produto_id, valor)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prod_classif_produto ON produto_classificacao (filial_id, produto_id)`;
  // Tabela nova => RLS ligado (senão a anon key lê/escreve via PostgREST)
  await sql`ALTER TABLE produto_classificacao ENABLE ROW LEVEL SECURITY`;

  console.log('[2] cotacao_item.classificacao...');
  await sql`ALTER TABLE cotacao_item ADD COLUMN IF NOT EXISTS classificacao varchar(60)`;

  console.log('OK.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
