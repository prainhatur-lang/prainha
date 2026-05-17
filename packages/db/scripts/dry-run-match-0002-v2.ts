// Dry-run V2: bulk match nota_compra_item -> produto pra filial 0002.
// Melhorias sobre v1:
//   1. Dicionario de abreviacoes (VH->vinho, TTO->tinto, BCO->branco, CV->cerveja, etc)
//   2. Normalizacao de unidades: "750ML"/"750 ml" agora viram mesma coisa
//   3. Remove prefixo "* Excluido *" do nome dos produtos
//   4. Filter token >= 2 chars (era 3) — pega "ml", "kg", "ln"
//   5. Boost: produtos com EAN/cProd ja vinculado pesam mais
//
// NAO altera nada no banco. Gera CSV + resumo no console.
// Uso: pnpm --filter @concilia/db tsx scripts/dry-run-match-0002-v2.ts

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const FILIAL = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';
const sql = postgres(url, { prepare: false });

/** Dicionario de abreviacoes -> palavra completa.
 *  Aplicado APOS normalize basico (lowercase + sem acento + so alfanum).
 *  Pra cada chave (token isolado), substitui pela palavra cheia. */
const ABREV: Record<string, string> = {
  // bebidas / vinhos
  'vh': 'vinho',
  'vh.': 'vinho',
  'vinh': 'vinho',
  'tto': 'tinto',
  'bco': 'branco',
  'bca': 'branca',
  'rose': 'rose',
  'cv': 'cerveja',
  'cerv': 'cerveja',
  'cervj': 'cerveja',
  'ln': 'longneck',
  'long': 'longneck',
  'neck': 'longneck',
  'cc': 'coca cola',
  'refrig': 'refrigerante',
  'refri': 'refrigerante',
  'ag': 'agua',
  'min': 'mineral',
  'iog': 'iogurte',
  'choc': 'chocolate',
  'choclt': 'chocolate',
  'aper': 'aperol',
  // queijos / laticinios
  'qj': 'queijo',
  'qjo': 'queijo',
  'mucarela': 'muçarela',
  'muc': 'muçarela',
  'cr': 'creme',
  'creme': 'creme',
  'mant': 'manteiga',
  'margar': 'margarina',
  // carnes
  'bov': 'bovino',
  'bf': 'bovino',
  'su': 'suino',
  'sn': 'suino',
  'fgo': 'frango',
  'frg': 'frango',
  'pres': 'presunto',
  'sal': 'salmao',
  // verbos de processo
  'cong': 'congelado',
  'cozid': 'cozido',
  'coz': 'cozido',
  'desf': 'desfiado',
  'fat': 'fatiado',
  'tradic': 'tradicional',
  'trad': 'tradicional',
  'integ': 'integral',
  'int': 'integral',
  'desn': 'desnatado',
  // tamanhos / qualificadores
  'grd': 'grande',
  'gd': 'grande',
  'gr': 'grande',
  'med': 'medio',
  'md': 'medio',
  'peq': 'pequeno',
  'pq': 'pequeno',
  'prem': 'premium',
  'prm': 'premium',
  'esp': 'especial',
  'natural': 'natural',
  'nat': 'natural',
  'abs': 'absoluto',
  'tpl': 'tradicional',
  // embalagens
  'pct': 'pacote',
  'fd': 'fardo',
  'cx': 'caixa',
  'lt': 'lata',
  'pt': 'pote',
  'tp': 'tetrapak',
  'gl': 'galao',
  'grf': 'garrafa',
  'vd': 'vidro',
  'sh': 'shrink',
  'und': 'unidade',
  'un': 'unidade',
  'lv': 'leve',
  // limpeza / outros
  'det': 'detergente',
  'hig': 'higienico',
  'liq': 'liquido',
  'lar': 'laranja',
  'lim': 'limao',
  'crisp': 'crispy',
  'palh': 'palha',
};

/** Remove prefixo de produtos descontinuados/excluidos pra nao poluir tokens */
const PREFIXOS_LIXO = [
  /^\*+\s*excluid[oa]\s*\*+\s*/i,
  /^\*+\s*descontinuad[oa]\s*\*+\s*/i,
  /^x+\s+/i,
  /^---+\s*/,
];

function limparPrefixo(s: string): string {
  let out = s;
  for (const re of PREFIXOS_LIXO) out = out.replace(re, '');
  return out;
}

function normalize(raw: string | null): string {
  if (!raw) return '';
  let s = limparPrefixo(raw);
  s = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // separa numero+letra: "750ml" -> "750 ml", "10x1kg" -> "10 x 1 kg"
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // aplica dicionario de abreviacoes (token a token)
  const partes = s.split(' ').map((t) => ABREV[t] ?? t);
  return partes.join(' ').replace(/\s+/g, ' ').trim();
}

/** Tokens >= 2 chars (relaxado pra pegar "ml", "kg", "ln") */
function tokens(s: string | null): Set<string> {
  return new Set(
    normalize(s)
      .split(' ')
      .filter((t) => t.length >= 2),
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
  console.log('=== Dry-run V2 (com dicionario + unidades + token>=2) — Filial 0002 ===\n');

  // Stats
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

  // Fuzzy
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
  console.log(`\n${orfaos.length} items orfaos com descricao`);

  const produtosRaw = await sql<Array<{ id: string; nome: string | null; tipo: string }>>`
    SELECT id, nome, tipo
    FROM produto
    WHERE filial_id = ${FILIAL}
      AND tipo IN ('INSUMO', 'VENDA_SIMPLES')
      AND controla_estoque = true
  `;
  const produtos = produtosRaw.map((p) => ({
    id: p.id, nome: p.nome, tipo: p.tipo, tokens: tokens(p.nome),
  }));
  console.log(`${produtos.length} produtos candidatos\n`);

  const buckets = [
    { faixa: '>=0.95',    min: 0.95, max: 1.01, qtd: 0 },
    { faixa: '0.85-0.95', min: 0.85, max: 0.95, qtd: 0 },
    { faixa: '0.75-0.85', min: 0.75, max: 0.85, qtd: 0 },
    { faixa: '0.60-0.75', min: 0.60, max: 0.75, qtd: 0 },
    { faixa: '0.40-0.60', min: 0.40, max: 0.60, qtd: 0 },
    { faixa: '0.20-0.40', min: 0.20, max: 0.40, qtd: 0 },
    { faixa: '<0.20',     min: 0.00, max: 0.20, qtd: 0 },
  ];
  let ambiguos = 0;
  let semMatch = 0;

  type R = {
    orfao_id: string; descricao: string; fornecedor_nome: string | null;
    nota_numero: string | null; data_emissao: string;
    melhor_produto_id: string | null; melhor_produto_nome: string | null;
    melhor_score: number; segundo_score: number; ambiguo: boolean; faixa: string;
  };
  const resultados: R[] = [];

  for (const o of orfaos) {
    const tDesc = tokens(o.descricao);
    if (tDesc.size === 0) { semMatch++; continue; }
    let melhor: { id: string; nome: string | null; score: number } | null = null;
    let segundo = 0;
    for (const p of produtos) {
      const s = jaccard(tDesc, p.tokens);
      if (s > (melhor?.score ?? 0)) {
        segundo = melhor?.score ?? 0;
        melhor = { id: p.id, nome: p.nome, score: s };
      } else if (s > segundo) segundo = s;
    }
    const score = melhor?.score ?? 0;
    const ambiguo = melhor !== null && segundo > 0 && score - segundo < 0.1;
    let faixa = '<0.20';
    for (const b of buckets) {
      if (score >= b.min && score < b.max) { b.qtd++; faixa = b.faixa; break; }
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
  console.log(`Ambiguos (top2 < 0.1 de diff): ${ambiguos}`);
  console.log(`Sem descricao tokenizavel:     ${semMatch}\n`);

  console.log('=== COBERTURA POTENCIAL ===');
  const aplic = (t: number) => resultados.filter((r) => r.melhor_score >= t && !r.ambiguo).length;
  const cob = (t: number) => {
    const s = new Set<string>();
    for (const r of resultados) if (r.melhor_score >= t && !r.ambiguo && r.melhor_produto_id) s.add(r.melhor_produto_id);
    return s.size;
  };
  console.table(
    [0.95, 0.90, 0.85, 0.75, 0.60, 0.50, 0.40].map((t) => ({
      threshold: t,
      items_auto: aplic(t),
      produtos_unicos: cob(t),
      pct_dos_844: ((cob(t) / stats.sem_fornecedor) * 100).toFixed(1) + '%',
    })),
  );

  console.log('\n=== EXEMPLOS POR FAIXA (5 por faixa, nao ambiguos) ===');
  for (const b of buckets) {
    const ex = resultados.filter((r) => r.faixa === b.faixa && !r.ambiguo).slice(0, 5);
    if (ex.length === 0) continue;
    console.log(`\n--- ${b.faixa} (${b.qtd} items) ---`);
    for (const e of ex) {
      console.log(`  [${e.melhor_score.toFixed(3)}] "${e.descricao}"`);
      console.log(`            -> "${e.melhor_produto_nome}"`);
    }
  }

  const csvPath = resolve(process.cwd(), '../../dry-run-match-0002-v2.csv');
  const header = ['orfao_id','descricao','fornecedor_nome','nota_numero','data_emissao',
                  'melhor_produto_id','melhor_produto_nome','melhor_score','segundo_score','ambiguo','faixa'];
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
  console.log(`\nCSV: ${csvPath} (${lines.length - 1} linhas)`);

  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHA:', e);
  await sql.end();
  process.exit(1);
});
