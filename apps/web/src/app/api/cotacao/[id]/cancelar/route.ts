// POST /api/cotacao/[id]/cancelar
// Cancela uma cotação em aberto que não foi aprovada (dono 20/10/2026: as 34–37
// do Bar saíram da lista errada). Não apaga nada: a cotação fica como CANCELADA
// no histórico, o link do fornecedor para de aceitar resposta (o preencher já
// devolve 410) e os itens da Lista da semana que estavam presos nela voltam a
// ficar livres pra uma cotação nova.
// Só cancela RASCUNHO / ABERTA / AGUARDANDO_APROVACAO sem pedido de compra vivo.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq, ne } from 'drizzle-orm';

const CANCELAVEIS = new Set(['RASCUNHO', 'ABERTA', 'AGUARDANDO_APROVACAO']);

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cotacao.update');
  if (semPerm) return semPerm;

  const { id: cotacaoId } = await params;
  const [cot] = await db
    .select({ id: schema.cotacao.id, filialId: schema.cotacao.filialId, status: schema.cotacao.status })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, cotacaoId))
    .limit(1);
  if (!cot) return NextResponse.json({ error: 'cotação não encontrada' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === cot.filialId))
    return NextResponse.json({ error: 'filial sem acesso' }, { status: 403 });
  if (cot.status === 'CANCELADA') return NextResponse.json({ ok: true, jaEstava: true });
  if (!CANCELAVEIS.has(cot.status))
    return NextResponse.json({ error: 'cotação já aprovada — não dá pra cancelar' }, { status: 400 });

  const pedidos = await db
    .select({ id: schema.pedidoCompra.id })
    .from(schema.pedidoCompra)
    .where(and(eq(schema.pedidoCompra.cotacaoId, cotacaoId), ne(schema.pedidoCompra.status, 'CANCELADO')))
    .limit(1);
  if (pedidos.length)
    return NextResponse.json(
      { error: 'esta cotação já tem pedido de compra — cancele o pedido antes' },
      { status: 400 },
    );

  const liberados = await db.transaction(async (tx) => {
    await tx
      .update(schema.cotacao)
      .set({ status: 'CANCELADA' })
      .where(eq(schema.cotacao.id, cotacaoId));
    // Itens da lista presos nesta cotação voltam a ficar livres; a lista volta a ABERTA.
    const itens = await tx
      .update(schema.listaCompraItem)
      .set({ cotacaoId: null })
      .where(eq(schema.listaCompraItem.cotacaoId, cotacaoId))
      .returning({ listaId: schema.listaCompraItem.listaId });
    const listas = Array.from(new Set(itens.map((i) => i.listaId)));
    for (const listaId of listas)
      await tx
        .update(schema.listaCompra)
        .set({ status: 'ABERTA' })
        .where(eq(schema.listaCompra.id, listaId));
    return itens.length;
  });

  return NextResponse.json({ ok: true, itensLiberados: liberados });
}
