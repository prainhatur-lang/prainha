// POST /api/nota-compra/[id]/vincular-pedido
// Vincula manualmente uma NF a um pedido_compra (quando auto-match nao pegou).
// Reusa a logica de tentarMatchPedidoComNota mas com pedido_compra forcado.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: notaId } = await params;
  const form = await req.formData();
  const pedidoCompraId = form.get('pedidoCompraId') as string | null;
  if (!pedidoCompraId || !/^[0-9a-f-]{36}$/i.test(pedidoCompraId)) {
    return NextResponse.json({ error: 'pedidoCompraId invalido' }, { status: 400 });
  }

  const [nota] = await db
    .select({ id: schema.notaCompra.id, filialId: schema.notaCompra.filialId })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, notaId))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [pedido] = await db
    .select({ id: schema.pedidoCompra.id, filialId: schema.pedidoCompra.filialId })
    .from(schema.pedidoCompra)
    .where(eq(schema.pedidoCompra.id, pedidoCompraId))
    .limit(1);
  if (!pedido) return NextResponse.json({ error: 'pedido nao encontrado' }, { status: 404 });
  if (pedido.filialId !== nota.filialId) {
    return NextResponse.json({ error: 'pedido de outra filial' }, { status: 400 });
  }

  // Vincula NF ao pedido
  await db
    .update(schema.pedidoCompra)
    .set({ notaCompraId: notaId })
    .where(eq(schema.pedidoCompra.id, pedidoCompraId));

  // Liga itens por produto_id
  const itensPedido = await db
    .select({
      id: schema.pedidoCompraItem.id,
      produtoId: schema.pedidoCompraItem.produtoId,
      quantidade: schema.pedidoCompraItem.quantidade,
    })
    .from(schema.pedidoCompraItem)
    .where(eq(schema.pedidoCompraItem.pedidoCompraId, pedidoCompraId));

  const itensNF = await db
    .select({
      id: schema.notaCompraItem.id,
      produtoId: schema.notaCompraItem.produtoId,
      quantidade: schema.notaCompraItem.quantidade,
    })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.notaCompraId, notaId));

  let linkados = 0;
  let totalRecebidoCompleto = 0;
  for (const ip of itensPedido) {
    if (!ip.produtoId) continue;
    const inf = itensNF.find((i) => i.produtoId === ip.produtoId);
    if (!inf) continue;
    await db
      .update(schema.pedidoCompraItem)
      .set({ notaCompraItemId: inf.id, quantidadeRecebida: inf.quantidade })
      .where(eq(schema.pedidoCompraItem.id, ip.id));
    linkados++;
    if (Number(inf.quantidade) >= Number(ip.quantidade)) totalRecebidoCompleto++;
  }

  let novoStatus = 'ENTREGUE_PARCIAL';
  let reconciliadoEm: Date | null = null;
  if (linkados === itensPedido.length && totalRecebidoCompleto === itensPedido.length) {
    novoStatus = 'RECONCILIADO';
    reconciliadoEm = new Date();
  }

  await db
    .update(schema.pedidoCompra)
    .set({ status: novoStatus, reconciliadoEm, atualizadoEm: new Date() })
    .where(eq(schema.pedidoCompra.id, pedidoCompraId));

  // Redireciona de volta pra pagina da nota
  return NextResponse.redirect(new URL(`/movimento/entrada-notas/${notaId}`, req.url), 303);
}
