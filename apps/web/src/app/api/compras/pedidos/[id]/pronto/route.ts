// POST /api/compras/pedidos/[id]/pronto
// Pedido sob encomenda: o fornecedor avisou que ficou pronto. As parcelas
// "quando ficar pronto" que ainda não foram pagas passam a vencer HOJE
// (a conta em Pix sobe pra /financeiro/pedidos-pix).

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'conta_pagar.update');
  if (semPerm) return semPerm;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });

  const [ped] = await db
    .select({ id: schema.pedidoCompra.id, filialId: schema.pedidoCompra.filialId })
    .from(schema.pedidoCompra)
    .where(eq(schema.pedidoCompra.id, id))
    .limit(1);
  if (!ped) return NextResponse.json({ error: 'pedido nao encontrado' }, { status: 404 });
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, ped.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const parcelas = await db
    .select({ id: schema.pedidoCompraParcela.id, contaPagarId: schema.pedidoCompraParcela.contaPagarId })
    .from(schema.pedidoCompraParcela)
    .where(
      and(
        eq(schema.pedidoCompraParcela.pedidoCompraId, id),
        eq(schema.pedidoCompraParcela.quando, 'PRONTO'),
        isNull(schema.pedidoCompraParcela.prontoEm),
      ),
    );
  if (parcelas.length === 0) {
    return NextResponse.json({ error: 'nenhuma parcela esperando ficar pronto' }, { status: 400 });
  }
  const hoje = hojeBr();
  const contaIds = parcelas.map((p) => p.contaPagarId).filter((x): x is string => !!x);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.pedidoCompraParcela)
      .set({ prontoEm: new Date(), dataVencimento: hoje })
      .where(inArray(schema.pedidoCompraParcela.id, parcelas.map((p) => p.id)));
    if (contaIds.length) {
      // Só mexe no vencimento de conta ainda em aberto.
      await tx
        .update(schema.contaPagar)
        .set({ dataVencimento: hoje })
        .where(and(inArray(schema.contaPagar.id, contaIds), isNull(schema.contaPagar.dataPagamento)));
    }
  });
  return NextResponse.json({ ok: true, parcelas: parcelas.length, vencimento: hoje });
}
