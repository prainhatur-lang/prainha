// Popula produto_fornecedor a partir do historico de NFes.
//
// Logica: pra cada (produto_id, fornecedor_id) que ja apareceu em alguma
// nota_compra_item (com produto matchado) + nota_compra (com fornecedor
// matchado), cria vinculo em produto_fornecedor se ainda nao existe.
//
// Tambem agrega:
//   - ultima_compra_em: data_emissao mais recente entre as notas
//   - ultimo_preco_custo: valor_unitario da nota mais recente
//   - descricao_fornecedor: descricao da NF mais recente (texto que o
//     fornecedor usa)
//   - codigo_fornecedor: cProd da NF mais recente
//   - ean: ean da NF mais recente
//   - unidade_fornecedor: unidade da NF mais recente
//
// Idempotente: se vinculo ja existe, atualiza so esses campos.
//
// Uso: pnpm --filter @concilia/db backfill:produto-fornecedor

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  // Acha todos os pares (produto, fornecedor) com info agregada da NF mais recente
  process.stdout.write('  Coletando pares (produto, fornecedor) do historico de NFs... ');
  const pares = await sql<Array<{
    filial_id: string;
    produto_id: string;
    fornecedor_id: string;
    ultima_compra_em: Date | null;
    ultimo_preco: string | null;
    codigo_fornecedor: string | null;
    ean: string | null;
    descricao: string | null;
    unidade: string | null;
  }>>`
    SELECT DISTINCT ON (nci.filial_id, nci.produto_id, nc.fornecedor_id)
      nci.filial_id,
      nci.produto_id,
      nc.fornecedor_id,
      nc.data_emissao AS ultima_compra_em,
      nci.valor_unitario AS ultimo_preco,
      nci.codigo_produto_fornecedor AS codigo_fornecedor,
      nci.ean,
      nci.descricao,
      nci.unidade
    FROM nota_compra_item nci
    JOIN nota_compra nc ON nc.id = nci.nota_compra_id
    WHERE nci.produto_id IS NOT NULL
      AND nc.fornecedor_id IS NOT NULL
    ORDER BY nci.filial_id, nci.produto_id, nc.fornecedor_id, nc.data_emissao DESC NULLS LAST
  `;
  console.log(`OK — ${pares.length} pares unicos`);

  // Pra cada par, INSERT ou UPDATE em produto_fornecedor
  process.stdout.write('  Aplicando em produto_fornecedor... ');
  let criados = 0;
  let atualizados = 0;
  for (const p of pares) {
    // Tenta encontrar vinculo existente
    const existentes = await sql<Array<{ id: string }>>`
      SELECT id FROM produto_fornecedor
      WHERE produto_id = ${p.produto_id} AND fornecedor_id = ${p.fornecedor_id}
      LIMIT 1
    `;

    const valores = {
      descricaoFornecedor: p.descricao,
      codigoFornecedor: p.codigo_fornecedor,
      ean: p.ean,
      unidadeFornecedor: p.unidade,
      ultimoPrecoCusto: p.ultimo_preco,
      ultimaCompraEm: p.ultima_compra_em,
    };

    if (existentes.length > 0) {
      await sql`
        UPDATE produto_fornecedor SET
          descricao_fornecedor = ${valores.descricaoFornecedor},
          codigo_fornecedor = ${valores.codigoFornecedor},
          ean = ${valores.ean},
          unidade_fornecedor = ${valores.unidadeFornecedor},
          ultimo_preco_custo = ${valores.ultimoPrecoCusto},
          ultima_compra_em = ${valores.ultimaCompraEm},
          atualizado_em = now()
        WHERE id = ${existentes[0].id}
      `;
      atualizados++;
    } else {
      await sql`
        INSERT INTO produto_fornecedor (
          filial_id, produto_id, fornecedor_id, fator_conversao,
          descricao_fornecedor, codigo_fornecedor, ean, unidade_fornecedor,
          ultimo_preco_custo, ultima_compra_em
        ) VALUES (
          ${p.filial_id}, ${p.produto_id}, ${p.fornecedor_id}, '1',
          ${valores.descricaoFornecedor}, ${valores.codigoFornecedor}, ${valores.ean},
          ${valores.unidadeFornecedor}, ${valores.ultimoPrecoCusto}, ${valores.ultimaCompraEm}
        )
      `;
      criados++;
    }
  }
  console.log('OK');
  console.log(`\n  Criados: ${criados} novos vinculos`);
  console.log(`  Atualizados: ${atualizados} vinculos existentes`);

  // Resumo: vinculos por filial e produtos cobertos
  console.log('\n  Resumo por filial:');
  const resumo = await sql`
    SELECT fil.nome AS filial,
           count(DISTINCT pf.produto_id)::int AS produtos_com_fornecedor,
           count(DISTINCT pf.fornecedor_id)::int AS fornecedores_ativos,
           count(*)::int AS total_vinculos
    FROM produto_fornecedor pf
    JOIN filial fil ON fil.id = pf.filial_id
    GROUP BY fil.nome
    ORDER BY fil.nome
  `;
  console.table(resumo);

  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHA:', e);
  await sql.end();
  process.exit(1);
});
