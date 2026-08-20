// A fila de alteração passa a alcançar o WIZARD (perguntas de acompanhamento).
//
// Pergunta e opção não são "do produto": a mesma pergunta ("ponto da carne")
// serve vários pratos. Por isso a linha da fila ganha um alvo próprio em vez
// de fingir que a chave é o produto.
//
//   alvo = produto | variante | pergunta | opcao
//   alvo_codigo = CODIGO da pergunta/opção no Firebird (nulo nos dois primeiros)
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:produto-fila-alvo

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE produto_alteracao ADD COLUMN IF NOT EXISTS alvo varchar(12) NOT NULL DEFAULT 'produto'`);
  await sql.unsafe(`ALTER TABLE produto_alteracao ADD COLUMN IF NOT EXISTS alvo_codigo integer`);
  // produto_codigo_externo só faz sentido pros alvos de produto; wizard usa alvo_codigo
  await sql.unsafe(`ALTER TABLE produto_alteracao ALTER COLUMN produto_codigo_externo DROP NOT NULL`);
  const cols = await sql<Array<{ c: string; n: string }>>`
    SELECT column_name c, is_nullable n FROM information_schema.columns
    WHERE table_name='produto_alteracao' AND column_name IN ('alvo','alvo_codigo','produto_codigo_externo') ORDER BY 1`;
  console.log('[ok] produto_alteracao:', cols.map((x) => `${x.c}(null=${x.n})`).join(' · '));
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
