// POST /api/delivery-admin/pedido/[id]/nota — NFC-e do pedido do delivery pelo
// painel (dono 22/11/2026). Emite se ainda não tem (idempotente: a nota já
// emitida no despacho volta igual) e, com { imprimir: true }, manda o DANFE de
// novo pra impressora da loja. Devolve o id da nota pra abrir o DANFE no
// navegador (/fiscal/nfce/<id>/danfe).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { emitirNfceDelivery, situacaoNotaDelivery } from '@/lib/delivery/nfce-delivery';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** GET — situação da nota (o card mostra "NFC-e nº X" ou "sem nota"). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;
  const { id } = await ctx.params;
  const [p] = await db
    .select({ filialId: schema.deliveryPedido.filialId })
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.id, id))
    .limit(1);
  if (!p) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === p.filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }
  return NextResponse.json(await situacaoNotaDelivery(id));
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;
  const { id } = await ctx.params;
  const [p] = await db
    .select({ filialId: schema.deliveryPedido.filialId })
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.id, id))
    .limit(1);
  if (!p) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === p.filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }
  const b = await request.json().catch(() => null);
  const r = await emitirNfceDelivery(id, user.email ?? null, { imprimir: b?.imprimir === true });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json(r);
}
