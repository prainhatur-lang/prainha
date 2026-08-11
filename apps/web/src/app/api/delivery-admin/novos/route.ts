// GET /api/delivery-admin/novos?desde=<ISO> — pedidos que ficaram PAGOS desde
// o cursor. O painel usa isso pra tocar o sino e recarregar. Mesmo padrão de
// /api/reservas/chegadas (cursor ?desde= → { novos, agora }).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, gt, inArray, isNotNull } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { expirarPedidosPendentes } from '@/lib/delivery/pedido';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (filialIds.length === 0) {
    return NextResponse.json({ novos: [], agora: new Date().toISOString() });
  }

  await expirarPedidosPendentes();

  const desdeParam = new URL(request.url).searchParams.get('desde');
  const desde =
    desdeParam && !Number.isNaN(Date.parse(desdeParam))
      ? new Date(desdeParam)
      : new Date(Date.now() - 60_000);

  const novos = await db
    .select({
      id: schema.deliveryPedido.id,
      numero: schema.deliveryPedido.numero,
      clienteNome: schema.deliveryPedido.clienteNome,
      tipo: schema.deliveryPedido.tipo,
      total: schema.deliveryPedido.total,
    })
    .from(schema.deliveryPedido)
    .where(
      and(
        inArray(schema.deliveryPedido.filialId, filialIds),
        isNotNull(schema.deliveryPedido.pagoEm),
        gt(schema.deliveryPedido.pagoEm, desde),
      ),
    );

  return NextResponse.json({ novos, agora: new Date().toISOString() });
}
