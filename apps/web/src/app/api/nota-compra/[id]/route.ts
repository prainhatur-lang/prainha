// DELETE /api/nota-compra/[id]
// Apaga uma nota fiscal de entrada e reverte tudo que ela criou no estoque.
// Comportamento:
//  1. Busca todos os movimento_estoque criados a partir dessa nota (via
//     notaCompraItemId ∈ itens da nota).
//  2. Por produto, soma a quantidade lançada e CHECA SE NAO FICA NEGATIVO.
//     Se o produto ja teve saidas que consumiram esse lote (ex: vendas
//     desde o lancamento), a reversao deixaria estoque negativo — recusa.
//  3. Se OK: deleta os movimentos, ajusta produto.estoqueAtual subtraindo
//     a quantidade lancada. precoCusto NAO eh recalculado (seria caro
//     percorrer todo o historico) — fica como esta e o proximo MPM ajusta.
//  4. Deleta a nota (cascade ON DELETE remove notaCompraItem).
//
// O QUE NAO MUDA:
//  - produto_fornecedor (mappings) ficam — o user provavelmente vai
//    re-importar a mesma nota, e os mappings (com fator) sao aproveitados.
//  - precoCusto do produto (custo medio) — fica congelado no valor pos-
//    -entrada. Aproximacao aceitavel se a nota for re-lancada logo apos.
//
// XML: o sistema atualmente nao salva o XML no Storage (so xmlHash).
// Logo, nao tem arquivo pra deletar; basta apagar o registro.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(
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
      chave: schema.notaCompra.chave,
      numero: schema.notaCompra.numero,
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

  // Carrega itens da nota
  const itens = await db
    .select({ id: schema.notaCompraItem.id })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.notaCompraId, id));

  const itemIds = itens.map((it) => it.id);

  // Busca movimentos criados pela nota (so se houver itens)
  const movimentos = itemIds.length > 0
    ? await db
        .select({
          id: schema.movimentoEstoque.id,
          produtoId: schema.movimentoEstoque.produtoId,
          quantidade: schema.movimentoEstoque.quantidade,
          tipo: schema.movimentoEstoque.tipo,
        })
        .from(schema.movimentoEstoque)
        .where(inArray(schema.movimentoEstoque.notaCompraItemId, itemIds))
    : [];

  // Agrupa por produto pra checar reversao
  const qtdPorProduto = new Map<string, number>();
  for (const m of movimentos) {
    if (m.tipo !== 'ENTRADA_COMPRA') continue;
    const q = Number(m.quantidade ?? 0);
    qtdPorProduto.set(m.produtoId, (qtdPorProduto.get(m.produtoId) ?? 0) + q);
  }

  // Valida que a reversao nao deixa estoque negativo
  if (qtdPorProduto.size > 0) {
    const produtoIds = Array.from(qtdPorProduto.keys());
    const produtos = await db
      .select({
        id: schema.produto.id,
        nome: schema.produto.nome,
        estoqueAtual: schema.produto.estoqueAtual,
      })
      .from(schema.produto)
      .where(inArray(schema.produto.id, produtoIds));

    const conflitos: { nome: string; atual: number; aReverter: number }[] = [];
    for (const p of produtos) {
      const aReverter = qtdPorProduto.get(p.id) ?? 0;
      const atual = Number(p.estoqueAtual ?? 0);
      // Tolerancia minima por arredondamento
      if (atual + 1e-6 < aReverter) {
        conflitos.push({
          nome: p.nome ?? '(sem nome)',
          atual,
          aReverter,
        });
      }
    }

    if (conflitos.length > 0) {
      return NextResponse.json(
        {
          error:
            'reversao deixaria estoque negativo — produtos ja tiveram saidas (vendas/producao) consumindo esse lote',
          conflitos,
        },
        { status: 409 },
      );
    }
  }

  // Reversao: subtrai estoque + apaga movimentos.
  // Faz produto a produto pra ficar legivel; volume eh sempre baixo (1 nota).
  for (const [produtoId, qtd] of qtdPorProduto.entries()) {
    await db
      .update(schema.produto)
      .set({
        estoqueAtual: sql`COALESCE(${schema.produto.estoqueAtual}, 0) - ${qtd.toFixed(4)}`,
      })
      .where(eq(schema.produto.id, produtoId));
  }

  if (movimentos.length > 0) {
    const movIds = movimentos.map((m) => m.id);
    await db
      .delete(schema.movimentoEstoque)
      .where(inArray(schema.movimentoEstoque.id, movIds));
  }

  // Deleta a nota — cascade apaga notaCompraItem.
  await db.delete(schema.notaCompra).where(eq(schema.notaCompra.id, id));

  return NextResponse.json({
    ok: true,
    chave: nota.chave,
    numero: nota.numero,
    movimentosRevertidos: movimentos.length,
    produtosAjustados: qtdPorProduto.size,
  });
}
