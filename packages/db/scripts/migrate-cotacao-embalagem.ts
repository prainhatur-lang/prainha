// Cotação sem erro de tamanho/embalagem:
//  - cotacao_item.embalagem_esperada: o que a casa quer ("caixa 18 kg",
//    "balde 14,5 kg", "fardo 30x1kg"). Antes isso ia solto na observação e o
//    fornecedor cotava o quilo achando que era a caixa.
//  - cotacao_resposta_item.unidade_fornecedor: era varchar(10), não cabia
//    "caixa 18 kg". Vira varchar(40) pra o fornecedor dizer como ele vende.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('[1] cotacao_item.embalagem_esperada...');
  await sql`ALTER TABLE cotacao_item ADD COLUMN IF NOT EXISTS embalagem_esperada varchar(80)`;

  console.log('[2] cotacao_resposta_item.unidade_fornecedor -> varchar(40)...');
  await sql`ALTER TABLE cotacao_resposta_item ALTER COLUMN unidade_fornecedor TYPE varchar(40)`;

  console.log('OK.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
