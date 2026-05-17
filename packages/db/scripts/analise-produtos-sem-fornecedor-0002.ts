// Analise dos 844 produtos sem fornecedor na filial 0002 (Tabuara).
// V2: queries pequenas, agregacao em memoria (evita statement timeout).
//
// Classifica em buckets pra orientar acao:
//   1. BUG_BACKFILL:   ja tem item de NFe matchado a esse produto, so
//                       falta criar produto_fornecedor (rodar backfill)
//   2. AUTO_NFE:        tem item de NFe orfao com nome parecido
//                       (resolvivel via bulk match)
//   3. ATIVO_SEM_NFE:   vende nos ultimos 30d mas zero NFe matched
//                       (precisa cadastro manual OU compra sem nota)
//   4. POUCO_GIRO:      vendeu nos ultimos 90d mas nao nos 30d
//   5. INATIVO:         zero vendas nos ultimos 90d, mas vendeu em algum momento
//   6. NUNCA_VENDIDO:   zero vendas EVER = obsoleto/lixo
//   7. DESCONTINUADO:   ja marcado descontinuado no Consumer
//
// Gera CSV + resumo no console. NAO altera nada no banco.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const FILIAL = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';
const sql = postgres(url, { prepare: false });

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function normalize(s: string | null): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string | null): Set<string> {
  return new Set(normalize(s).split(' ').filter((t) => t.length >= 3));
}

async function main() {
  console.log('=== Analise: 844 produtos sem fornecedor — Tabuara 0002 ===\n');

  // 1. Lista de produtos sem fornecedor (cheap)
  process.stdout.write('  1. Carregando produtos sem fornecedor... ');
  const produtos = await sql<Array<{
    id: string;
    nome: string;
    tipo: string;
    descontinuado: boolean | null;
    controla_estoque: boolean | null;
    categoria_compras: string | null;
  }>>`
    SELECT p.id, p.nome, p.tipo, p.descontinuado, p.controla_estoque, p.categoria_compras
    FROM produto p
    WHERE p.filial_id = ${FILIAL}
      AND p.tipo IN ('INSUMO', 'VENDA_SIMPLES')
      AND NOT EXISTS (SELECT 1 FROM produto_fornecedor pf WHERE pf.produto_id = p.id)
  `;
  console.log(`OK — ${produtos.length}`);

  // 2. Items de NFe ja matchados por produto (GROUP BY 1 vez)
  process.stdout.write('  2. Agregando NFe items matchados... ');
  const nfeMatchedRows = await sql<Array<{ produto_id: string; n: number }>>`
    SELECT produto_id, count(*)::int AS n
    FROM nota_compra_item
    WHERE filial_id = ${FILIAL}
      AND produto_id IS NOT NULL
    GROUP BY produto_id
  `;
  const nfeMatched = new Map(nfeMatchedRows.map((r) => [r.produto_id, r.n]));
  console.log(`OK — ${nfeMatchedRows.length} produtos com NFe matchada`);

  // 3. Vendas por produto (3 GROUP BY 1 vez cada)
  process.stdout.write('  3. Agregando vendas totais... ');
  const vendasTotal = await sql<Array<{ produto_id: string; n: number; ultima: Date }>>`
    SELECT pi.produto_id, count(*)::int AS n, max(pe.data_abertura) AS ultima
    FROM pedido_item pi
    JOIN pedido pe ON pe.id = pi.pedido_id
    WHERE pi.filial_id = ${FILIAL} AND pi.produto_id IS NOT NULL
    GROUP BY pi.produto_id
  `;
  const vendasMap = new Map(vendasTotal.map((r) => [r.produto_id, { total: r.n, ultima: r.ultima }]));
  console.log(`OK — ${vendasTotal.length} produtos com vendas`);

  process.stdout.write('  4. Agregando vendas 90d... ');
  const vendas90 = await sql<Array<{ produto_id: string; n: number }>>`
    SELECT pi.produto_id, count(*)::int AS n
    FROM pedido_item pi
    JOIN pedido pe ON pe.id = pi.pedido_id
    WHERE pi.filial_id = ${FILIAL}
      AND pi.produto_id IS NOT NULL
      AND pe.data_abertura > NOW() - INTERVAL '90 days'
    GROUP BY pi.produto_id
  `;
  const vendas90Map = new Map(vendas90.map((r) => [r.produto_id, r.n]));
  console.log(`OK — ${vendas90.length}`);

  process.stdout.write('  5. Agregando vendas 30d... ');
  const vendas30 = await sql<Array<{ produto_id: string; n: number; qtd: number }>>`
    SELECT pi.produto_id, count(*)::int AS n, sum(pi.quantidade)::int AS qtd
    FROM pedido_item pi
    JOIN pedido pe ON pe.id = pi.pedido_id
    WHERE pi.filial_id = ${FILIAL}
      AND pi.produto_id IS NOT NULL
      AND pe.data_abertura > NOW() - INTERVAL '30 days'
    GROUP BY pi.produto_id
  `;
  const vendas30Map = new Map(vendas30.map((r) => [r.produto_id, { n: r.n, qtd: r.qtd }]));
  console.log(`OK — ${vendas30.length}`);

  // 6. Items orfaos da filial com descricao (pra checar candidatos de match)
  process.stdout.write('  6. Carregando NFe items orfaos... ');
  const orfaos = await sql<Array<{ descricao: string }>>`
    SELECT descricao
    FROM nota_compra_item
    WHERE filial_id = ${FILIAL}
      AND produto_id IS NULL
      AND descricao IS NOT NULL
  `;
  // Pre-tokeniza orfaos uma vez
  const orfaoTokenSets = orfaos.map((o) => tokens(o.descricao));
  console.log(`OK — ${orfaos.length}`);

  // 7. Pra cada produto, conta quantos orfaos compartilham >= 1 token
  process.stdout.write('  7. Matching tokens em memoria... ');
  const orfaoTokenMatch = new Map<string, number>();
  for (const p of produtos) {
    const tProd = tokens(p.nome);
    if (tProd.size === 0) {
      orfaoTokenMatch.set(p.id, 0);
      continue;
    }
    let n = 0;
    for (const tOrf of orfaoTokenSets) {
      for (const t of tProd) {
        if (tOrf.has(t)) { n++; break; }
      }
    }
    orfaoTokenMatch.set(p.id, n);
  }
  console.log('OK');

  // 8. Classifica
  type Bucket =
    | 'BUG_BACKFILL'
    | 'AUTO_NFE'
    | 'ATIVO_SEM_NFE'
    | 'POUCO_GIRO'
    | 'INATIVO'
    | 'NUNCA_VENDIDO'
    | 'DESCONTINUADO';

  const enriched = produtos.map((p) => {
    const v = vendasMap.get(p.id);
    const v90 = vendas90Map.get(p.id) ?? 0;
    const v30 = vendas30Map.get(p.id) ?? { n: 0, qtd: 0 };
    const matched = nfeMatched.get(p.id) ?? 0;
    const orfTokens = orfaoTokenMatch.get(p.id) ?? 0;
    let bucket: Bucket;
    if (p.descontinuado) bucket = 'DESCONTINUADO';
    else if (matched > 0) bucket = 'BUG_BACKFILL';
    else if (orfTokens > 0) bucket = 'AUTO_NFE';
    else if (!v || v.total === 0) bucket = 'NUNCA_VENDIDO';
    else if (v30.n > 0) bucket = 'ATIVO_SEM_NFE';
    else if (v90 > 0) bucket = 'POUCO_GIRO';
    else bucket = 'INATIVO';
    return {
      ...p,
      items_nfe_matched: matched,
      orfaos_token_match: orfTokens,
      vendas_total: v?.total ?? 0,
      vendas_90d: v90,
      vendas_30d: v30.n,
      qtd_vendida_30d: v30.qtd,
      ultima_venda: v?.ultima ?? null,
      bucket,
    };
  });

  const order: Bucket[] = [
    'BUG_BACKFILL', 'AUTO_NFE', 'ATIVO_SEM_NFE', 'POUCO_GIRO', 'INATIVO',
    'NUNCA_VENDIDO', 'DESCONTINUADO',
  ];
  const grouped = new Map<Bucket, typeof enriched>();
  for (const e of enriched) {
    if (!grouped.has(e.bucket)) grouped.set(e.bucket, []);
    grouped.get(e.bucket)!.push(e);
  }

  console.log('\n=== Distribuicao por bucket ===');
  console.table(
    order
      .filter((b) => grouped.has(b))
      .map((b) => ({
        bucket: b,
        qtd: grouped.get(b)!.length,
        pct: ((grouped.get(b)!.length / enriched.length) * 100).toFixed(1) + '%',
      })),
  );

  console.log('\n=== Exemplos por bucket (5 cada) ===');
  for (const b of order) {
    const lista = grouped.get(b);
    if (!lista || lista.length === 0) continue;
    console.log(`\n--- ${b} (${lista.length}) ---`);
    for (const p of lista.slice(0, 5)) {
      const lastV = p.ultima_venda ? p.ultima_venda.toISOString().slice(0, 10) : '—';
      console.log(
        `  [${p.tipo.padEnd(13)}] ${p.nome ?? '(sem nome)'}` +
        `\n     vendas:${p.vendas_total} (30d:${p.vendas_30d}) NFe-matched:${p.items_nfe_matched}` +
        ` orfaos-token:${p.orfaos_token_match} ultimaVenda:${lastV}`,
      );
    }
  }

  // CSV
  const csvPath = resolve(process.cwd(), '../../analise-produtos-sem-fornecedor-0002.csv');
  const header = [
    'bucket', 'produto_id', 'nome', 'tipo', 'descontinuado', 'controla_estoque',
    'categoria_compras', 'items_nfe_matched', 'orfaos_token_match',
    'vendas_total', 'vendas_90d', 'vendas_30d', 'qtd_vendida_30d', 'ultima_venda',
  ];
  const lines = [header.join(',')];
  for (const p of enriched) {
    lines.push([
      p.bucket, p.id, p.nome, p.tipo, p.descontinuado, p.controla_estoque,
      p.categoria_compras, p.items_nfe_matched, p.orfaos_token_match,
      p.vendas_total, p.vendas_90d, p.vendas_30d, p.qtd_vendida_30d,
      p.ultima_venda ? p.ultima_venda.toISOString().slice(0, 10) : '',
    ].map(csvCell).join(','));
  }
  writeFileSync(csvPath, lines.join('\n'), 'utf8');
  console.log(`\nCSV: ${csvPath} (${lines.length - 1} linhas)`);

  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHA:', e);
  await sql.end();
  process.exit(1);
});
