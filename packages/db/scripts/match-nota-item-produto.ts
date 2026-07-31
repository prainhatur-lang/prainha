// Match em massa: nota_compra_item.produto_id NULL -> produto interno.
//
// 3 estrategias em ordem de confianca:
//   1. EAN exato — quando a NF tem EAN preenchido e algum produto tem
//      produto_fornecedor.ean igual, OU outra nota com mesmo EAN ja foi linkada.
//      ATENCAO: o ean fica em produto_fornecedor, nao em produto direto.
//      Por simplicidade matchamos via produto_fornecedor.
//   2. codigo_produto_fornecedor — se o item da NF tem cProd igual ao
//      produto_fornecedor.codigo_fornecedor de um vinculo ja existente
//      (mesmo fornecedor).
//   3. Descricao fuzzy (jaccard de tokens 3+ chars) — threshold >= 0.5
//      contra produto.nome de itens com categoria_compras (entram em cotacao).
//
// Idempotente: so atualiza items com produto_id NULL.
//
// Uso: pnpm --filter @concilia/db match:nota-item-produto

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

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

async function main() {
  // --- Etapa 1: EAN exato ---
  process.stdout.write('  Etapa 1: match por EAN exato... ');
  const etapa1 = await sql<Array<{ id: string }>>`
    UPDATE nota_compra_item nci
    SET produto_id = pf.produto_id
    FROM produto_fornecedor pf
    WHERE nci.produto_id IS NULL
      AND nci.ean IS NOT NULL
      AND nci.ean = pf.ean
      AND nci.filial_id = pf.filial_id
    RETURNING nci.id
  `;
  console.log(`OK — ${etapa1.length} items linkados`);

  // --- Etapa 2: codigo_produto_fornecedor + fornecedor da NF ---
  process.stdout.write('  Etapa 2: match por cProd + fornecedor... ');
  const etapa2 = await sql<Array<{ id: string }>>`
    UPDATE nota_compra_item nci
    SET produto_id = pf.produto_id
    FROM produto_fornecedor pf, nota_compra nc
    WHERE nci.produto_id IS NULL
      AND nci.nota_compra_id = nc.id
      AND nc.fornecedor_id = pf.fornecedor_id
      AND nci.codigo_produto_fornecedor IS NOT NULL
      AND nci.codigo_produto_fornecedor = pf.codigo_fornecedor
      AND nci.filial_id = pf.filial_id
    RETURNING nci.id
  `;
  console.log(`OK — ${etapa2.length} items linkados`);

  // --- Etapa 3: fuzzy por descricao ---
  console.log('  Etapa 3: fuzzy match por descricao (threshold 0.5)...');

  // Carrega items sem produto_id agrupados por filial
  const orfaos = await sql<Array<{
    id: string;
    filial_id: string;
    descricao: string | null;
  }>>`
    SELECT id, filial_id, descricao
    FROM nota_compra_item
    WHERE produto_id IS NULL AND descricao IS NOT NULL
  `;
  console.log(`    ${orfaos.length} items orfaos com descricao`);

  // Carrega produtos com categoria_compras pra cada filial
  const produtos = await sql<Array<{
    id: string;
    filial_id: string;
    nome: string | null;
  }>>`
    SELECT id, filial_id, nome
    FROM produto
    WHERE categoria_compras IS NOT NULL AND controla_estoque = true
  `;
  // Index por filial
  const produtosPorFilial = new Map<string, Array<{ id: string; tokens: Set<string> }>>();
  for (const p of produtos) {
    if (!produtosPorFilial.has(p.filial_id)) produtosPorFilial.set(p.filial_id, []);
    produtosPorFilial.get(p.filial_id)!.push({ id: p.id, tokens: tokens(p.nome) });
  }

  // Match
  let linkados3 = 0;
  let ambiguos = 0;
  for (const o of orfaos) {
    const lista = produtosPorFilial.get(o.filial_id) ?? [];
    if (lista.length === 0) continue;
    const tDesc = tokens(o.descricao);
    if (tDesc.size === 0) continue;

    let melhor: { id: string; score: number } | null = null;
    let segundo = 0;
    for (const p of lista) {
      const s = jaccard(tDesc, p.tokens);
      if (s > (melhor?.score ?? 0)) {
        segundo = melhor?.score ?? 0;
        melhor = { id: p.id, score: s };
      } else if (s > segundo) {
        segundo = s;
      }
    }
    if (!melhor || melhor.score < 0.5) continue;
    // Evita ambiguidade: se o segundo colocado é muito proximo, nao linka
    if (segundo > 0 && melhor.score - segundo < 0.1) {
      ambiguos++;
      continue;
    }
    await sql`UPDATE nota_compra_item SET produto_id = ${melhor.id} WHERE id = ${o.id}`;
    linkados3++;
  }
  console.log(`    ${linkados3} items linkados por descricao`);
  console.log(`    ${ambiguos} items pulados (ambiguidade — top score muito proximo do 2)`);

  // Resumo final
  console.log('\n=== Resumo ===');
  console.log(`Etapa 1 (EAN):       ${etapa1.length}`);
  console.log(`Etapa 2 (cProd):     ${etapa2.length}`);
  console.log(`Etapa 3 (descricao): ${linkados3}`);
  console.log(`Total linkados:      ${etapa1.length + etapa2.length + linkados3}`);

  const [{ ainda_sem }] = await sql<Array<{ ainda_sem: number }>>`
    SELECT count(*)::int AS ainda_sem
    FROM nota_compra_item
    WHERE produto_id IS NULL
  `;
  console.log(`\nAinda sem produto_id: ${ainda_sem} (precisa link manual)`);

  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHA:', e);
  await sql.end();
  process.exit(1);
});
