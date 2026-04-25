// POST /api/nota-compra/[id]/lancar-estoque
// Lança todos os itens mapeados da nota como ENTRADA_COMPRA em movimento_estoque
// e atualiza produto.estoqueAtual + produto_fornecedor.ultimoPrecoCusto/ultimaCompraEm.
//
// CUSTEIO:
//  - Aplica FATOR DE RATEIO da NFe (frete + outras despesas - desconto)
//    proporcionalmente ao valor de cada item: custoTotalReal = valorItem × fator.
//    Ex: NFe 1500 produtos + 30 frete = 1530 total → fator 1.02 → cada item
//    paga proporcionalmente o frete.
//  - Atualiza produto.precoCusto via MÉDIA PONDERADA MÓVEL (MPM):
//    novoCusto = (saldoAnterior×custoAnterior + qtdEntrada×custoEntrada) / saldoNovo
//
// Idempotente: se já existe movimento com notaCompraItemId, pula aquele item.
// Erro se nenhum item está mapeado.
//
// Conversão de unidade: usa o fator de produto_fornecedor (se existir) pra
// converter da unidade do fornecedor (kg fatura pacote) pra unidade interna.
// Se não existe mapeamento, assume fator 1.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { aplicarMpmEntrada, fatorRateioNfe } from '@/lib/custo-medio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      fornecedorId: schema.notaCompra.fornecedorId,
      dataEmissao: schema.notaCompra.dataEmissao,
      dataEntrada: schema.notaCompra.dataEntrada,
      situacao: schema.notaCompra.situacao,
      valorTotal: schema.notaCompra.valorTotal,
      valorProdutos: schema.notaCompra.valorProdutos,
      valorFrete: schema.notaCompra.valorFrete,
      valorSeguro: schema.notaCompra.valorSeguro,
      valorOutros: schema.notaCompra.valorOutros,
      valorDesconto: schema.notaCompra.valorDesconto,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  if (nota.situacao === 'CANCELADA' || nota.situacao === 'DENEGADA') {
    return NextResponse.json(
      { error: `nao pode lancar nota ${nota.situacao}` },
      { status: 400 },
    );
  }

  const itens = await db
    .select({
      id: schema.notaCompraItem.id,
      produtoId: schema.notaCompraItem.produtoId,
      quantidade: schema.notaCompraItem.quantidade,
      valorUnitario: schema.notaCompraItem.valorUnitario,
      valorTotal: schema.notaCompraItem.valorTotal,
      ean: schema.notaCompraItem.ean,
      codigoProdutoFornecedor: schema.notaCompraItem.codigoProdutoFornecedor,
      descricao: schema.notaCompraItem.descricao,
    })
    .from(schema.notaCompraItem)
    .where(
      and(
        eq(schema.notaCompraItem.notaCompraId, id),
        isNotNull(schema.notaCompraItem.produtoId),
      ),
    );

  if (itens.length === 0) {
    return NextResponse.json(
      { error: 'nenhum item mapeado — vincule os produtos primeiro' },
      { status: 400 },
    );
  }

  const dataMov = nota.dataEntrada ?? nota.dataEmissao ?? new Date();

  // Fator de rateio da NFe: distribui frete/outros/desconto proporcionalmente
  // ao valor dos produtos. Ex: vNF 1530 / vProd 1500 = 1.02 → cada item paga
  // 2% extra. Default 1 (sem rateio) se nota não tem detalhamento.
  const fatorRateio = fatorRateioNfe({
    valorTotal: nota.valorTotal,
    valorProdutos: nota.valorProdutos,
  });

  let lancados = 0;
  let pulados = 0;

  for (const item of itens) {
    if (!item.produtoId) continue;

    const [jaMov] = await db
      .select({ id: schema.movimentoEstoque.id })
      .from(schema.movimentoEstoque)
      .where(eq(schema.movimentoEstoque.notaCompraItemId, item.id))
      .limit(1);
    if (jaMov) {
      pulados++;
      continue;
    }

    // Busca mapeamento produto×fornecedor pra fator e pra atualizar último custo
    let fator = 1;
    let pfId: string | null = null;
    if (nota.fornecedorId) {
      const [pf] = await db
        .select({
          id: schema.produtoFornecedor.id,
          fatorConversao: schema.produtoFornecedor.fatorConversao,
        })
        .from(schema.produtoFornecedor)
        .where(
          and(
            eq(schema.produtoFornecedor.fornecedorId, nota.fornecedorId),
            eq(schema.produtoFornecedor.produtoId, item.produtoId),
          ),
        )
        .limit(1);
      if (pf) {
        fator = Number(pf.fatorConversao) || 1;
        pfId = pf.id;
      }
    }

    const qtdFornecedor = Number(item.quantidade ?? 0);
    const valorBrutoItem = Number(item.valorTotal ?? 0); // valor do produto SEM frete
    // Custo total real do item = valorBruto × fator de rateio
    const custoTotalRealItem = valorBrutoItem * fatorRateio;
    // Converte qtd pra unidade interna do produto
    const qtdInterna = qtdFornecedor * fator;
    // Custo unitário INTERNO (já com rateio + conversão)
    const precoInternoComRateio = qtdInterna > 0 ? custoTotalRealItem / qtdInterna : 0;
    // Mantemos também o preço sem rateio pra registro no produto_fornecedor
    const precoFornecedorSemRateio = Number(item.valorUnitario ?? 0);
    const precoInternoSemRateio =
      fator > 0 ? precoFornecedorSemRateio / fator : precoFornecedorSemRateio;

    await db.insert(schema.movimentoEstoque).values({
      filialId: nota.filialId,
      produtoId: item.produtoId,
      tipo: 'ENTRADA_COMPRA',
      quantidade: qtdInterna.toFixed(4),
      precoUnitario: precoInternoComRateio.toFixed(6),
      valorTotal: custoTotalRealItem.toFixed(2),
      dataHora: dataMov,
      notaCompraItemId: item.id,
      criadoPor: user.id,
      observacao:
        fatorRateio !== 1
          ? `rateio frete/despesas: ×${fatorRateio.toFixed(4)}`
          : null,
    });

    // MPM: atualiza estoqueAtual + precoCusto via média ponderada
    await aplicarMpmEntrada({
      produtoId: item.produtoId,
      qtdEntrada: qtdInterna,
      custoEntrada: precoInternoComRateio,
    });

    if (pfId) {
      // Mantém o "preço de etiqueta" do fornecedor (sem rateio) pra
      // comparar próximas compras facilmente. Quem absorve o frete é
      // o produto.precoCusto via MPM.
      await db
        .update(schema.produtoFornecedor)
        .set({
          ultimoPrecoCusto: precoFornecedorSemRateio.toFixed(4),
          ultimoPrecoCustoUnidade: precoInternoSemRateio.toFixed(6),
          ultimaCompraEm: dataMov,
        })
        .where(eq(schema.produtoFornecedor.id, pfId));
    }

    lancados++;
  }

  return NextResponse.json({
    lancados,
    pulados,
    totalMapeados: itens.length,
    fatorRateio,
  });
}
