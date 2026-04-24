// POST /api/nota-compra/[id]/match-auto
// Tenta mapear os itens não-mapeados da nota para produtos internos via:
//  1) EAN do item ↔ produto_fornecedor.ean (mesma filial)
//  2) EAN do item ↔ produto.codigoEtiqueta (mesma filial)
//  3) codigoProdutoFornecedor ↔ produto_fornecedor.codigoFornecedor
//     (escopo no fornecedor da nota)
// Retorna quantos foram mapeados e quantos sobraram.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

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

  const itens = await db
    .select({
      id: schema.notaCompraItem.id,
      ean: schema.notaCompraItem.ean,
      codigoProdutoFornecedor: schema.notaCompraItem.codigoProdutoFornecedor,
    })
    .from(schema.notaCompraItem)
    .where(
      and(
        eq(schema.notaCompraItem.notaCompraId, id),
        isNull(schema.notaCompraItem.produtoId),
      ),
    );

  let mapeados = 0;
  for (const item of itens) {
    let produtoId: string | null = null;

    if (item.ean) {
      const [pf] = await db
        .select({ produtoId: schema.produtoFornecedor.produtoId })
        .from(schema.produtoFornecedor)
        .where(
          and(
            eq(schema.produtoFornecedor.filialId, nota.filialId),
            eq(schema.produtoFornecedor.ean, item.ean),
          ),
        )
        .limit(1);
      if (pf) produtoId = pf.produtoId;
    }

    if (!produtoId && item.ean) {
      const [p] = await db
        .select({ id: schema.produto.id })
        .from(schema.produto)
        .where(
          and(
            eq(schema.produto.filialId, nota.filialId),
            eq(schema.produto.codigoEtiqueta, item.ean),
          ),
        )
        .limit(1);
      if (p) produtoId = p.id;
    }

    if (!produtoId && item.codigoProdutoFornecedor && nota.fornecedorId) {
      const [pf] = await db
        .select({ produtoId: schema.produtoFornecedor.produtoId })
        .from(schema.produtoFornecedor)
        .where(
          and(
            eq(schema.produtoFornecedor.fornecedorId, nota.fornecedorId),
            eq(schema.produtoFornecedor.codigoFornecedor, item.codigoProdutoFornecedor),
          ),
        )
        .limit(1);
      if (pf) produtoId = pf.produtoId;
    }

    if (produtoId) {
      await db
        .update(schema.notaCompraItem)
        .set({ produtoId })
        .where(eq(schema.notaCompraItem.id, item.id));
      mapeados++;
    }
  }

  const [totais] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      mapeados: sql<number>`COUNT(${schema.notaCompraItem.produtoId})::int`,
    })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.notaCompraId, id));

  return NextResponse.json({
    matched: mapeados,
    total: totais?.total ?? 0,
    mapeadosTotal: totais?.mapeados ?? 0,
  });
}
