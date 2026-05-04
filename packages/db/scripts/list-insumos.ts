// Lista produtos cadastrados que entram em compras (INSUMO ou VENDA_SIMPLES
// com controla_estoque=true). Output em CSV no stdout pra cruzar com o
// catalogo de cotacao.
//
// Uso:
//   pnpm --filter @concilia/db tsx scripts/list-insumos.ts > insumos-atual.csv

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  const rows = await sql<
    Array<{
      id: string;
      filial: string;
      tipo: string;
      nome: string | null;
      unidade_estoque: string;
      controla_estoque: boolean;
      preco_custo: string | null;
      estoque_atual: string | null;
      descontinuado: boolean | null;
    }>
  >`
    SELECT
      p.id,
      f.nome AS filial,
      p.tipo,
      p.nome,
      p.unidade_estoque,
      p.controla_estoque,
      p.preco_custo,
      p.estoque_atual,
      p.descontinuado
    FROM produto p
    JOIN filial f ON f.id = p.filial_id
    WHERE p.tipo IN ('INSUMO', 'VENDA_SIMPLES')
      AND p.controla_estoque = true
      AND COALESCE(p.descontinuado, false) = false
    ORDER BY f.nome, p.tipo, p.nome
  `;

  console.log('filial,tipo,nome,unidade_estoque,preco_custo,estoque_atual,produto_id');
  for (const r of rows) {
    console.log(
      [
        escapeCsv(r.filial),
        escapeCsv(r.tipo),
        escapeCsv(r.nome),
        escapeCsv(r.unidade_estoque),
        escapeCsv(r.preco_custo),
        escapeCsv(r.estoque_atual),
        r.id,
      ].join(','),
    );
  }

  console.error(`\n${rows.length} produtos exportados (INSUMO + VENDA_SIMPLES com controle de estoque)`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
