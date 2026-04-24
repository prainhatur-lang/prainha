// PATCH /api/nota-compra-item/[id]
// Opera o mapeamento do item ↔ produto interno. Body pode ser uma de duas formas:
//  1) { produtoId }  — vincula item ao produto existente
//  2) { produtoId: null }  — desvincula
// Quando vincula, se a nota tem fornecedorId, atualiza/cria o mapeamento em
// produto_fornecedor (upsert) gravando codigo + ean + descricao + unidade
// vindo do item, pra o match-auto pegar automaticamente nas próximas notas
// desse fornecedor.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  produtoId: z.string().uuid().nullable(),
});

export async function PATCH(
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

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }

  const [item] = await db
    .select({
      id: schema.notaCompraItem.id,
      notaCompraId: schema.notaCompraItem.notaCompraId,
      filialId: schema.notaCompraItem.filialId,
      codigoProdutoFornecedor: schema.notaCompraItem.codigoProdutoFornecedor,
      ean: schema.notaCompraItem.ean,
      descricao: schema.notaCompraItem.descricao,
      unidade: schema.notaCompraItem.unidade,
      quantidade: schema.notaCompraItem.quantidade,
      valorUnitario: schema.notaCompraItem.valorUnitario,
    })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.id, id))
    .limit(1);
  if (!item) return NextResponse.json({ error: 'item nao encontrado' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, item.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const [movExist] = await db
    .select({ id: schema.movimentoEstoque.id })
    .from(schema.movimentoEstoque)
    .where(eq(schema.movimentoEstoque.notaCompraItemId, id))
    .limit(1);
  if (movExist) {
    return NextResponse.json(
      { error: 'item ja foi lancado no estoque — desfaca o lancamento antes' },
      { status: 409 },
    );
  }

  const { produtoId } = parsed.data;

  if (produtoId) {
    const [prod] = await db
      .select({ id: schema.produto.id, filialId: schema.produto.filialId })
      .from(schema.produto)
      .where(eq(schema.produto.id, produtoId))
      .limit(1);
    if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });
    if (prod.filialId !== item.filialId) {
      return NextResponse.json({ error: 'produto em filial diferente' }, { status: 400 });
    }
  }

  await db
    .update(schema.notaCompraItem)
    .set({ produtoId })
    .where(eq(schema.notaCompraItem.id, id));

  // Se vinculou e nota tem fornecedor, upsert em produto_fornecedor pra
  // acelerar matches futuros do mesmo fornecedor com o mesmo código/EAN.
  if (produtoId) {
    const [nota] = await db
      .select({ fornecedorId: schema.notaCompra.fornecedorId })
      .from(schema.notaCompra)
      .where(eq(schema.notaCompra.id, item.notaCompraId))
      .limit(1);

    if (nota?.fornecedorId && (item.codigoProdutoFornecedor || item.ean)) {
      const [existente] = await db
        .select({ id: schema.produtoFornecedor.id })
        .from(schema.produtoFornecedor)
        .where(
          and(
            eq(schema.produtoFornecedor.fornecedorId, nota.fornecedorId),
            eq(schema.produtoFornecedor.produtoId, produtoId),
          ),
        )
        .limit(1);

      if (!existente) {
        try {
          await db.insert(schema.produtoFornecedor).values({
            filialId: item.filialId,
            produtoId,
            fornecedorId: nota.fornecedorId,
            codigoFornecedor: item.codigoProdutoFornecedor,
            ean: item.ean,
            descricaoFornecedor: item.descricao,
            unidadeFornecedor: item.unidade,
            fatorConversao: '1',
          });
        } catch {
          // Conflito de unique (ex: mesmo código mapeado pra outro produto).
          // Ignora — o usuário pode resolver manualmente em /cadastros/produtos/[id].
        }
      }
    }
  }

  return NextResponse.json({ id, produtoId });
}
