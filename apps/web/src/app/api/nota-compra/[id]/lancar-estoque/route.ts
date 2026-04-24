// POST /api/nota-compra/[id]/lancar-estoque
// Lança todos os itens mapeados da nota como ENTRADA_COMPRA em movimento_estoque
// e atualiza produto.estoqueAtual + produto_fornecedor.ultimoPrecoCusto/ultimaCompraEm.
//
// Idempotente: se já existe movimento com notaCompraItemId, pula aquele item.
// Erro se nenhum item está mapeado. Retorna contadores do lançamento.
//
// Conversão de unidade: usa o fator de produto_fornecedor (se existir) pra
// converter da unidade do fornecedor (kg fatura pacote) pra unidade interna.
// Se não existe mapeamento, assume fator 1.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

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
    const precoFornecedor = Number(item.valorUnitario ?? 0);
    const qtdInterna = qtdFornecedor * fator;
    const precoInterno = fator > 0 ? precoFornecedor / fator : precoFornecedor;
    const valorTotal = qtdInterna * precoInterno;

    await db.insert(schema.movimentoEstoque).values({
      filialId: nota.filialId,
      produtoId: item.produtoId,
      tipo: 'ENTRADA_COMPRA',
      quantidade: qtdInterna.toFixed(4),
      precoUnitario: precoInterno.toFixed(6),
      valorTotal: valorTotal.toFixed(2),
      dataHora: dataMov,
      notaCompraItemId: item.id,
      criadoPor: user.id,
    });

    await db
      .update(schema.produto)
      .set({
        estoqueAtual: sql`COALESCE(${schema.produto.estoqueAtual}, 0) + ${qtdInterna.toFixed(4)}`,
        precoCusto: precoInterno.toFixed(4),
      })
      .where(eq(schema.produto.id, item.produtoId));

    if (pfId) {
      await db
        .update(schema.produtoFornecedor)
        .set({
          ultimoPrecoCusto: precoFornecedor.toFixed(4),
          ultimoPrecoCustoUnidade: precoInterno.toFixed(6),
          ultimaCompraEm: dataMov,
        })
        .where(eq(schema.produtoFornecedor.id, pfId));
    }

    lancados++;
  }

  return NextResponse.json({ lancados, pulados, totalMapeados: itens.length });
}
