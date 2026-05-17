// Dry-run de bulk match nota_compra_item -> produto pra filial 0002 (Tabuara).
// NAO altera nada no banco. Gera:
//   - Resumo no console com distribuicao de scores
//   - CSV em ../../dry-run-match-0002.csv com cada orfao + top sugestao
//   - Cobertura potencial: quantos produtos hoje sem fornecedor ficariam
//     cobertos se aplicasse threshold X
//
// Uso: pnpm --filter @concilia/db tsx scripts/dry-run-match-0002.ts

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const FILIAL = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7'; // Tabuara 0002

const sql = postgres(url, { prepare: false });

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
  return new Set(
    normalize(s)
      .split(' ')
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  console.log('=== Dry-run match nota_compra_item -> produto (Filial 0002 Tabuara) ===\n');

  // 1. Stats inicial
  const [stats] = await sql<Array<{
    total_produtos: number;
    sem_fornecedor: number;
    items_orfaos: number;
    items_linkados: number;
    vinculos_atuais: number;
  }>>`
    SELECT
      (SELECT count(*)::int FROM produto WHERE filial_id = ${FILIAL}) AS total_produtos,
      (SELECT count(*)::int FROM produto p
         WHERE p.filial_id = ${FILIAL}
           AND p.tipo IN ('INSUMO', 'VENDA_SIMPLES')
           AND NOT EXISTS (SELECT 1 FROM produto_fornecedor pf WHERE pf.produto_id = p.id)
        ) AS sem_fornecedor,
      (SELECT count(*)::int FROM nota_compra_item WHERE filial_id = ${FILIAL} AND produto_id IS NULL) AS items_orfaos,
      (SELECT count(*)::int FROM nota_compra_item WHERE filial_id = ${FILIAL} AND produto_id IS NOT NULL) AS items_linkados,
      (SELECT count(*)::int FROM produto_fornecedor WHERE filial_id = ${FILIAL}) AS vinculos_atuais
  `;
  console.log('Estado atual da 0002:');
  console.table(stats);
  console.log('');

  // 2. EAN matches (etapa 1 do match-nota-item-produto.ts)
  const [eanRow] = await sql<Array<{ n: number }>>`
    SELECT count(DISTINCT nci.id)::int AS n
    FROM nota_compra_item nci, produto_fornecedor pf
    WHERE nci.filial_id = ${FILIAL}
      AND nci.produto_id IS NULL
      AND nci.ean IS NOT NULL
      AND nci.ean = pf.ean
      AND nci.filial_id = pf.filial_id
  `;
  console.log(`Etapa 1 — EAN exato match:    ${eanRow.n} items linkaveis`);

  // 3. cProd matches (etapa 2)
  const [cprodRow] = await sql<Array<{ n: number }>>`
    SELECT count(DISTINCT nci.id)::int AS n
    FROM nota_compra_item nci
    JOIN nota_compra nc ON nc.id = nci.nota_compra_id
    JOIN produto_fornecedor pf ON pf.fornecedor_id = nc.fornecedor_id AND pf.filial_id = nci.filial_id
    WHERE nci.filial_id = ${FILIAL}
      AND nci.produto_id IS NULL
      AND nci.codigo_produto_fornecedor IS NOT NULL
      AND nci.codigo_produto_fornecedor = pf.codigo_fornecedor
  `;
  console.log(`Etapa 2 — cProd + fornecedor: ${cprodRow.n} items linkaveis`);

  // 4. Fuzzy match com distribuicao de scores
  console.log('\nEtapa 3 — Fuzzy (jaccard) — analisando todos orfaos da 0002...');

  const orfaos = await sql<Array<{
    id: string;
    descricao: string | null;
    fornecedor_nome: string | null;
    nota_numero: string | null;
    data_emissao: Date | null;
  }>>`
    SELECT nci.id, nci.descricao,
           f.nome AS fornecedor_nome,
           nc.numero AS nota_numero,
           nc.data_emissao
    FROM nota_compra_item nci
    JOIN nota_compra nc ON nc.id = nci.nota_compra_id
    LEFT JOIN fornecedor f ON f.id = nc.fornecedor_id
    WHERE nci.filial_id = ${FILIAL}
      AND nci.produto_id IS NULL
      AND nci.descricao IS NOT NULL
  `;
  console.log(`  ${orfaos.length} items orfaos com descricao na 0002`);

  const produtosRaw = await sql<Array<{ id: string; nome: string | null; tipo: string }>>`
    SELECT id, nome, tipo
    FROM produto
    WHERE filial_id = ${FILIAL}
      AND tipo IN ('INSUMO', 'VENDA_SIMPLES')
      AND controla_estoque = true
  `;
  const produtos = produtosRaw.map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo, tokens: tokens(p.nome) }));
  console.log(`  ${produtos.length} produtos candidatos na 0002`);
  console.log('');

  // Faixas de score
  const buckets = [
    { faixa: '>=0.95',     min: 0.95, max: 1.01, qtd: 0 },
    { faixa: '0.85-0.95',  min: 0.85, max: 0.95, qtd: 0 },
    { faixa: '0.75-0.85',  min: 0.75, max: 0.85, qtd: 0 },
    { faixa: '0.60-0.75',  min: 0.60, max: 0.75, qtd: 0 },
    { faixa: '0.40-0.60',  min: 0.40, max: 0.60, qtd: 0 },
    { faixa: '0.20-0.40',  min: 0.20, max: 0.40, qtd: 0 },
    { faixa: '<0.20',      min: 0.00, max: 0.20, qtd: 0 },
  ];
  let ambiguos = 0;
  let semMatch = 0;

  type Resultado = {
    orfao_id: string;
    descricao: string;
    fornecedor_nome: string | null;
    nota_numero: string | null;
    data_emissao: string;
    melhor_produto_id: string | null;
    melhor_produto_nome: string | null;
    melhor_score: number;
    segundo_score: number;
    ambiguo: boolean;
    faixa: string;
  };
  const resultados: Resultado[] = [];

  for (const o of orfaos) {
    const tDesc = tokens(o.descricao);
    if (tDesc.size === 0) {
      semMatch++;
      continue;
    }
    let melhor: { id: string; nome: string | null; score: number } | null = null;
    let segundo = 0;
    for (const p of produtos) {
      const s = jaccard(tDesc, p.tokens);
      if (s > (melhor?.score ?? 0)) {
        segundo = melhor?.score ?? 0;
        melhor = { id: p.id, nome: p.nome, score: s };
      } else if (s > segundo) {
        segundo = s;
      }
    }

    const score = melhor?.score ?? 0;
    const ambiguo = melhor !== null && segundo > 0 && score - segundo < 0.1;
    let faixa = '<0.20';
    for (const b of buckets) {
      if (score >= b.min && score < b.max) {
        b.qtd++;
        faixa = b.faixa;
        break;
      }
    }
    if (ambiguo) ambiguos++;

    resultados.push({
      orfao_id: o.id,
      descricao: o.descricao ?? '',
      fornecedor_nome: o.fornecedor_nome,
      nota_numero: o.nota_numero,
      data_emissao: o.data_emissao ? o.data_emissao.toISOString().slice(0, 10) : '',
      melhor_produto_id: melhor?.id ?? null,
      melhor_produto_nome: melhor?.nome ?? null,
      melhor_score: score,
      segundo_score: segundo,
      ambiguo,
      faixa,
    });
  }

  console.log('Distribuicao de scores:');
  console.table(buckets);
  console.log(`  Ambiguos (top2 < 0.1 de diff):   ${ambiguos}`);
  console.log(`  Sem descricao tokenizavel:       ${semMatch}`);
  console.log('');

  // Cobertura potencial em produtos cobertos
  console.log('=== COBERTURA POTENCIAL DE PRODUTO_FORNECEDOR ===\n');
  const aplicaveis_em_threshold = (t: number) =>
    resultados.filter((r) => r.melhor_score >= t && !r.ambiguo).length;
  const produtos_cobertos_em_threshold = (t: number) => {
    const set = new Set<string>();
    for (const r of resultados) {
      if (r.melhor_score >= t && !r.ambiguo && r.melhor_produto_id) {
        set.add(r.melhor_produto_id);
      }
    }
    return set.size;
  };

  const thresholds = [0.95, 0.90, 0.85, 0.75, 0.60, 0.50];
  console.table(
    thresholds.map((t) => ({
      threshold: t,
      items_auto_linkados: aplicaveis_em_threshold(t),
      produtos_unicos_cobertos: produtos_cobertos_em_threshold(t),
      pct_dos_844_sem_fornecedor:
        ((produtos_cobertos_em_threshold(t) / stats.sem_fornecedor) * 100).toFixed(1) + '%',
    })),
  );

  // Exemplos por faixa pra o usuario calibrar
  console.log('\n=== EXEMPLOS POR FAIXA (5 por faixa) ===\n');
  for (const b of buckets) {
    const exemplos = resultados
      .filter((r) => r.faixa === b.faixa && !r.ambiguo)
      .slice(0, 5);
    if (exemplos.length === 0) continue;
    console.log(`\n--- Faixa ${b.faixa} (${b.qtd} items) ---`);
    for (const e of exemplos) {
      console.log(`  [${e.melhor_score.toFixed(3)}] "${e.descricao}"`);
      console.log(`            -> "${e.melhor_produto_nome}"`);
    }
  }

  // CSV completo (so o que tem melhor_produto_id)
  const csvPath = resolve(process.cwd(), '../../dry-run-match-0002.csv');
  const header = [
    'orfao_id', 'descricao', 'fornecedor_nome', 'nota_numero', 'data_emissao',
    'melhor_produto_id', 'melhor_produto_nome', 'melhor_score', 'segundo_score',
    'ambiguo', 'faixa',
  ];
  const lines = [header.join(',')];
  for (const r of resultados) {
    if (!r.melhor_produto_id) continue;
    lines.push([
      r.orfao_id, r.descricao, r.fornecedor_nome, r.nota_numero, r.data_emissao,
      r.melhor_produto_id, r.melhor_produto_nome, r.melhor_score.toFixed(4),
      r.segundo_score.toFixed(4), r.ambiguo, r.faixa,
    ].map(csvCell).join(','));
  }
  writeFileSync(csvPath, lines.join('\n'), 'utf8');
  console.log(`\nCSV salvo em: ${csvPath}`);
  console.log(`  ${lines.length - 1} linhas (so items com pelo menos 1 sugestao)`);

  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHA:', e);
  await sql.end();
  process.exit(1);
});
