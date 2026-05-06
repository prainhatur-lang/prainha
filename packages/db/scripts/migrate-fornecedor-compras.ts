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

  console.log('\n[2] Inferindo ativo_compras + categoria_compras do historico');
  // Estrategia: usar a hierarquia do plano de contas. No Consumer existe um
  // grupo pai "Fornecedores" com filhos (Aquisicao de Material, Aquisicao de
  // Produtos Acabados, Aquisicao de Insumos, Entrega). Pegamos todos os filhos
  // dessa categoria pai por filial.
  const categoriasPai = await sql<Array<{ id: string; codigo_externo: number; filial_id: string }>>`
    SELECT id, codigo_externo, filial_id FROM categoria_conta
    WHERE excluida_em IS NULL
      AND lower(descricao) LIKE '%fornecedor%'
      AND codigo_pai_externo IS NULL
  `;
  console.log(`  ${categoriasPai.length} categorias-pai 'Fornecedores' encontradas (uma por filial)`);

  // Filhas dessas categorias-pai
  const filhas = categoriasPai.length === 0
    ? []
    : await sql<Array<{ id: string; descricao: string; filial_id: string }>>`
        SELECT id, descricao, filial_id FROM categoria_conta
        WHERE excluida_em IS NULL
          AND filial_id = ANY(${categoriasPai.map((c) => c.filial_id)}::uuid[])
          AND codigo_pai_externo = ANY(${categoriasPai.map((c) => c.codigo_externo)}::integer[])
      `;
  console.log(`  ${filhas.length} subcategorias filhas:`);
  for (const f of filhas) console.log(`    - ${f.descricao}`);

  if (filhas.length === 0) {
    console.log('\n  Nenhuma subcategoria de Fornecedores encontrada — nada a inferir.');
  } else {
    const ids = filhas.map((c) => c.id);

    // Marca ativo_compras=true em fornecedores com pelo menos 1 conta_pagar nessas subcategorias
    const ativos = await run('marcar ativo_compras=true', async () => {
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
    console.log(`  ${ativos.length} fornecedores marcados como ativo_compras=true`);

    // Calcula a subcategoria mais usada por fornecedor (pra preencher categoria_compras)
    await run('calcular categoria_compras dominante por fornecedor', async () => {
      return sql`
        WITH cont_por_forn_cat AS (
          SELECT
            cp.fornecedor_id,
            cc.descricao,
            COUNT(*) AS qtd
          FROM conta_pagar cp
          JOIN categoria_conta cc ON cc.id = cp.categoria_id
          WHERE cp.fornecedor_id IS NOT NULL
            AND cp.categoria_id = ANY(${ids}::uuid[])
          GROUP BY cp.fornecedor_id, cc.descricao
        ),
        ranked AS (
          SELECT
            fornecedor_id,
            descricao,
            ROW_NUMBER() OVER (PARTITION BY fornecedor_id ORDER BY qtd DESC, descricao ASC) AS rn
          FROM cont_por_forn_cat
        )
        UPDATE fornecedor f
        SET categoria_compras = r.descricao
        FROM ranked r
        WHERE f.id = r.fornecedor_id
          AND r.rn = 1
          AND (f.categoria_compras IS NULL OR f.categoria_compras = '')
      `;
    });
  }

  console.log('\nMigration concluida.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
