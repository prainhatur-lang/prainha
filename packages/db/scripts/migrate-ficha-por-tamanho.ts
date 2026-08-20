// FICHA TÉCNICA POR TAMANHO (e a venda passando a guardar qual tamanho saiu).
//
// A ficha do Concilia era por PRODUTO. A do Consumer é por TAMANHO — e a
// diferença não é detalhe: em 168 dos 1.006 pares (produto, insumo) a
// quantidade muda com o tamanho.
//
//   Vodka Absolut 1L → 0,06 na dose · 1,00 na garrafa
//   Gelo wisky       → 0,10 na dose · 3,00 na garrafa
//
// Importar por produto erraria 17% das receitas — e erraria pro lado caro:
// dose baixando garrafa inteira.
//
// Duas mudanças:
//  1) ficha_tecnica ganha variante_id + unidade (un/kg/l/g/ml). Linha COM
//     variante vale só pra aquele tamanho; linha SEM variante é o padrão do
//     produto (o que já existia).
//  2) pedido_item passa a guardar codigo_variante_externo (CODIGOPRODUTODETALHE).
//     Sem isso não dá pra saber QUAL tamanho foi vendido — o agente resolvia o
//     produto-pai e jogava o tamanho fora.
//
// A unique antiga (produto_id, insumo_id) tinha que sair: com ficha por
// tamanho o mesmo par se repete uma vez por tamanho. Virou duas parciais.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:ficha-por-tamanho

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE ficha_tecnica ADD COLUMN IF NOT EXISTS variante_id uuid REFERENCES produto_variante(id) ON DELETE CASCADE`);
  await sql.unsafe(`ALTER TABLE ficha_tecnica ADD COLUMN IF NOT EXISTS codigo_variante_externo integer`);
  await sql.unsafe(`ALTER TABLE ficha_tecnica ADD COLUMN IF NOT EXISTS unidade varchar(6)`);
  await sql.unsafe(`ALTER TABLE ficha_tecnica ADD COLUMN IF NOT EXISTS origem varchar(12) NOT NULL DEFAULT 'nuvem'`);
  await sql.unsafe(`ALTER TABLE ficha_tecnica DROP CONSTRAINT IF EXISTS uq_ficha_prod_insumo`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ficha_prod_insumo_sem_var
    ON ficha_tecnica (produto_id, insumo_id) WHERE variante_id IS NULL`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ficha_var_insumo
    ON ficha_tecnica (variante_id, insumo_id) WHERE variante_id IS NOT NULL`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ficha_variante ON ficha_tecnica (filial_id, variante_id)`);

  await sql.unsafe(`ALTER TABLE pedido_item ADD COLUMN IF NOT EXISTS codigo_variante_externo integer`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_pedido_item_variante ON pedido_item (filial_id, codigo_variante_externo)`);

  const c = await sql<Array<{ t: string; c: string }>>`
    SELECT table_name t, column_name c FROM information_schema.columns
    WHERE (table_name='ficha_tecnica' AND column_name IN ('variante_id','codigo_variante_externo','unidade','origem'))
       OR (table_name='pedido_item' AND column_name='codigo_variante_externo')
    ORDER BY 1,2`;
  console.log('[ok] colunas: ' + c.map((x) => `${x.t}.${x.c}`).join(' · '));
  const n = await sql<Array<{ n: number }>>`SELECT count(*)::int n FROM ficha_tecnica`;
  console.log(`[ok] ficha_tecnica tem ${n[0].n} linhas`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
