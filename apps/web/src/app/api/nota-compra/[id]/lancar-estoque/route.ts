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
//
// CONTAS A PAGAR (NEW):
//  - Body opcional: { categoriaId: uuid }
//  - Se ha duplicatas em nota_compra_duplicata e nenhuma virou conta_pagar
//    ainda, cria 1 conta_pagar por duplicata (origem='NFE', notaCompraId,
//    categoriaId, fornecedorId vindo da nota).
//  - Se ja tem (contaPagarId nao null), pula — idempotente.
//  - Se a nota nao tem duplicatas, nao cria nada (compra a vista, fornecedor
//    nao preencheu cobr no XML, etc.).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { aplicarMpmEntrada, fatorRateioNfe } from '@/lib/custo-medio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  categoriaId: z.string().uuid().nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  // Body opcional: { categoriaId } pra criar contas a pagar
  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido' }, { status: 400 });
  }
  const categoriaId = parsed.data.categoriaId ?? null;

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      fornecedorId: schema.notaCompra.fornecedorId,
      numero: schema.notaCompra.numero,
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

  // ===== CONTAS A PAGAR (a partir das duplicatas do XML) =====
  // Le as duplicatas que ainda nao viraram conta_pagar e cria.
  // Se a nota nao tem fornecedorId, nao da pra criar (financeiro precisa
  // de fornecedor) — pula com aviso.
  let contasCriadas = 0;
  let contasPuladas = 0;
  if (nota.fornecedorId) {
    const duplicatas = await db
      .select({
        id: schema.notaCompraDuplicata.id,
        numero: schema.notaCompraDuplicata.numero,
        dataVencimento: schema.notaCompraDuplicata.dataVencimento,
        valor: schema.notaCompraDuplicata.valor,
      })
      .from(schema.notaCompraDuplicata)
      .where(
        and(
          eq(schema.notaCompraDuplicata.notaCompraId, id),
          isNull(schema.notaCompraDuplicata.contaPagarId),
        ),
      );

    const total = duplicatas.length;
    for (let i = 0; i < duplicatas.length; i++) {
      const d = duplicatas[i];
      const descricaoConta = nota.numero
        ? `NFe nº ${nota.numero}${total > 1 ? ` — parcela ${i + 1}/${total}` : ''}`
        : `NFe duplicata ${d.numero ?? i + 1}/${total}`;

      const [novaConta] = await db
        .insert(schema.contaPagar)
        .values({
          filialId: nota.filialId,
          // origem='NFE'; codigoExterno=null ate o agente fazer match
          origem: 'NFE',
          notaCompraId: id,
          fornecedorId: nota.fornecedorId,
          categoriaId: categoriaId,
          parcela: i + 1,
          totalParcelas: total,
          dataVencimento: d.dataVencimento,
          valor: d.valor,
          descricao: descricaoConta,
        })
        .returning({ id: schema.contaPagar.id });

      if (novaConta) {
        await db
          .update(schema.notaCompraDuplicata)
          .set({ contaPagarId: novaConta.id })
          .where(eq(schema.notaCompraDuplicata.id, d.id));
        contasCriadas++;
      }
    }

    // Quantas ja existiam (pra reportar)
    const [stats] = await db
      .select({
        total: schema.notaCompraDuplicata.id,
      })
      .from(schema.notaCompraDuplicata)
      .where(
        and(
          eq(schema.notaCompraDuplicata.notaCompraId, id),
          isNotNull(schema.notaCompraDuplicata.contaPagarId),
        ),
      )
      .limit(1);
    if (stats) contasPuladas = 0; // simplifica: nao contamos as ja existentes
  }

  return NextResponse.json({
    lancados,
    pulados,
    totalMapeados: itens.length,
    fatorRateio,
    contasPagarCriadas: contasCriadas,
    contasPagarPuladas: contasPuladas,
  });
}
