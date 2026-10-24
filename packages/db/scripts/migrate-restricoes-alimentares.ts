// Cardápio inclusivo completo (desenho de 15/10/2026): o que cada insumo /
// prato CONTÉM, a revisão da cozinha e a chave por casa.
//
//  - restricao_marca: "contém X" num INSUMO ou num PRATO, guardado pelo NOME
//    normalizado (sem acento, minúsculo, espaços únicos). Por nome = a marca
//    vale nas 3 casas pra quem tiver o mesmo nome.
//  - restricao_revisao: a cozinha conferiu o prato. Guarda EXATAMENTE o que
//    foi conferido (lista de restrições). Se numa casa o cálculo der outra
//    coisa (ficha diferente, insumo mudou), lá volta pra "a revisar".
//  - filial.cardapio_restricoes: liga a lista completa no QR daquela casa.
//    Desligada, o QR continua com o filtro antigo (sem glúten / sem lactose).
//
// A tabela antiga produto_restricao (selos sem glúten / sem lactose) fica
// como está e continua valendo.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:restricoes-alimentares

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS restricao_marca (
      organizacao_id uuid NOT NULL,
      alvo varchar(8) NOT NULL,
      nome_norm text NOT NULL,
      restricao varchar(16) NOT NULL,
      nome text,
      marcado_por text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organizacao_id, alvo, nome_norm, restricao)
    )
  `);
  await sql.unsafe(`ALTER TABLE restricao_marca ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] restricao_marca');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS restricao_revisao (
      organizacao_id uuid NOT NULL,
      nome_norm text NOT NULL,
      conferido text NOT NULL DEFAULT '',
      nome text,
      filial_id uuid,
      revisado_por text,
      revisado_em timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organizacao_id, nome_norm)
    )
  `);
  await sql.unsafe(`ALTER TABLE restricao_revisao ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] restricao_revisao');

  await sql.unsafe(`ALTER TABLE filial ADD COLUMN IF NOT EXISTS cardapio_restricoes boolean NOT NULL DEFAULT false`);
  console.log('[ok] filial.cardapio_restricoes');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
