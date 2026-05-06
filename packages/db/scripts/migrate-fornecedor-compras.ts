// Aplica migration delta no fornecedor + faz auto-deteccao de ativo_compras
// baseado no historico de conta_pagar.
//
// 1. ALTER fornecedor ADD COLUMN ativo_compras + categoria_compras
// 2. Marca como ativo_compras=true fornecedores que ja tiveram conta_pagar em
//    categoria contendo 'produto', 'insumo', 'alimento' ou 'merc' no nome.
//
// Idempotente.
//
// Uso: pnpm --filter @concilia/db migrate:fornecedor-compras

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  try {
    const r = await fn();
    console.log('OK');
    return r;
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function main() {
  console.log('[1] Colunas novas em fornecedor');
  await run('ativo_compras', () =>
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS ativo_compras boolean NOT NULL DEFAULT false`,
  );
  await run('categoria_compras', () =>
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS categoria_compras varchar(50)`,
  );
  await run('idx_fornecedor_ativo_compras', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_fornecedor_ativo_compras ON fornecedor (filial_id, ativo_compras) WHERE ativo_compras = true`,
  );

  console.log('\n[2] Inferindo ativo_compras do historico');
  // Quais categorias_conta tem nome compativel com compras de produtos/insumos
  const categorias = await sql<Array<{ id: string; descricao: string; filial_id: string }>>`
    SELECT id, descricao, filial_id FROM categoria_conta
    WHERE excluida_em IS NULL
      AND (
        lower(descricao) LIKE '%produto%' OR
        lower(descricao) LIKE '%insumo%' OR
        lower(descricao) LIKE '%alimento%' OR
        lower(descricao) LIKE '%merc%' OR
        lower(descricao) LIKE '%hortifruti%' OR
        lower(descricao) LIKE '%bebida%'
      )
  `;
  console.log(`  ${categorias.length} categorias compativeis encontradas:`);
  for (const c of categorias) console.log(`    - ${c.descricao}`);

  if (categorias.length === 0) {
    console.log('\n  Nenhuma categoria compativel — nada a inferir.');
  } else {
    const ids = categorias.map((c) => c.id);
    const result = await run('UPDATE fornecedor SET ativo_compras=true WHERE tem conta_pagar nessas categorias', async () => {
      return sql`
        UPDATE fornecedor
        SET ativo_compras = true
        WHERE id IN (
          SELECT DISTINCT cp.fornecedor_id
          FROM conta_pagar cp
          WHERE cp.fornecedor_id IS NOT NULL
            AND cp.categoria_id = ANY(${ids}::uuid[])
        )
        RETURNING id
      `;
    });
    console.log(`  ${result.length} fornecedores marcados como ativo_compras=true`);
  }

  console.log('\nMigration concluida.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
