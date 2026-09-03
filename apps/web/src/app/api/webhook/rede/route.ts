// POST /api/webhook/rede — notificação da Rede (e.Rede) de Pix pago/devolvido.
//
// Body (doc e.Rede → Pix → "Notificação de atualização de status via webhook"):
//   { id, merchantId (PV), events: ["PV.UPDATE_TRANSACTION_PIX" | "PV.REFUND_PIX"],
//     data: { txid, id: <TID>, endToEndId } }
// O TID é o nosso paymentId. Redundante com o polling das telas (que já
// reconsultam sozinhas) — o webhook só acelera. A URL é cadastrada POR CNPJ
// na central da Rede (não tem API pra isso).
//
// Auth opcional: se REDE_WEBHOOK_SECRET estiver setada, exige o header
// `authorization` igual (a Rede permite combinar um valor no piloto).
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { queryPayment, refundPayment } from '@/lib/pagamento-online';
import { marcarReservaPaga } from '@/lib/reservas/pagamento';
import { marcarOrcamentoEntradaPaga } from '@/lib/orcamentos-server';
import { marcarDeliveryPedidoPago } from '@/lib/delivery/pedido';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function processarOrcamento(paymentId: string, origin: string): Promise<void> {
  const [orc] = await db
    .select({ id: schema.orcamentoEvento.id, pagamentoStatus: schema.orcamentoEvento.pagamentoStatus, filialId: schema.orcamentoEvento.filialId })
    .from(schema.orcamentoEvento)
    .where(eq(schema.orcamentoEvento.pagamentoId, paymentId))
    .limit(1);
  if (!orc) { await processarDelivery(paymentId, origin); return; }
  const p = await queryPayment(paymentId, orc.filialId);
  if (p.status === 'pago' && orc.pagamentoStatus !== 'pago') {
    await marcarOrcamentoEntradaPaga(orc.id);
  } else if (p.status !== 'pendente' && p.status !== orc.pagamentoStatus) {
    await db.update(schema.orcamentoEvento).set({ pagamentoStatus: p.status }).where(eq(schema.orcamentoEvento.id, orc.id));
  }
}

async function processarDelivery(paymentId: string, origin: string): Promise<void> {
  const [ped] = await db
    .select({ id: schema.deliveryPedido.id, status: schema.deliveryPedido.status, pagamentoStatus: schema.deliveryPedido.pagamentoStatus, filialId: schema.deliveryPedido.filialId })
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.pagamentoId, paymentId))
    .limit(1);
  if (!ped) return;
  const p = await queryPayment(paymentId, ped.filialId);
  if (p.status === 'pago' && ped.status === 'pendente_pagamento') {
    await marcarDeliveryPedidoPago(ped.id, origin);
  } else if (p.status !== 'pendente' && p.status !== ped.pagamentoStatus) {
    await db.update(schema.deliveryPedido).set({ pagamentoStatus: p.status }).where(eq(schema.deliveryPedido.id, ped.id));
  }
}

/** A Rede SONDA a URL com GET (visto nos logs de produção em 03/09, 01:16 —
 *  validação de "URL válida e segura"). Sem isto respondia 405 e o cadastro da
 *  URL em produção poderia ser recusado. */
export async function GET() {
  return NextResponse.json({ ok: true, webhook: 'rede' });
}

export async function POST(request: NextRequest) {
  const expected = process.env.REDE_WEBHOOK_SECRET;
  if (expected) {
    const received = request.headers.get('authorization') || '';
    if (received !== expected && received !== `Bearer ${expected}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  // Sempre 200: a Rede reenvia se não receber sucesso. Erros são best-effort.
  let body: { events?: string[]; data?: { id?: string; txid?: string } } | null = null;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: true }); }
  const eventos = Array.isArray(body?.events) ? body!.events!.map(String) : [];
  const paymentId = String(body?.data?.id || '');
  // Log de chegada: nos logs da Vercel a linha vinha "(no message)" — sem isto
  // não dá pra responder "a Rede avisou?" (visto na validação do sandbox 03/09).
  console.log('[webhook rede]', eventos.join(',') || '(sem evento)', 'tid', paymentId || '(sem tid)');
  if (!paymentId || !eventos.some((e) => e === 'PV.UPDATE_TRANSACTION_PIX' || e === 'PV.REFUND_PIX')) {
    return NextResponse.json({ ok: true });
  }
  try {
    const origin = new URL(request.url).origin;
    const [reserva] = await db.select().from(schema.reserva).where(eq(schema.reserva.pagamentoId, paymentId)).limit(1);
    if (!reserva) { await processarOrcamento(paymentId, origin); return NextResponse.json({ ok: true }); }
    const p = await queryPayment(paymentId, reserva.filialId);
    if (p.status === 'pago' && reserva.pagamentoStatus !== 'pago') {
      if (reserva.status === 'cancelada') {
        // Pix chegou pra reserva já cancelada: devolve na hora (Pix = síncrono).
        const r = await refundPayment(paymentId, undefined, reserva.filialId);
        const st = r.status === 'reembolsado' ? 'reembolsado' : 'estorno_falhou_100';
        await db.update(schema.reserva).set({ pagamentoStatus: st }).where(eq(schema.reserva.id, reserva.id));
      } else {
        await marcarReservaPaga(reserva.id, origin);
      }
    } else if (p.status !== reserva.pagamentoStatus && p.status !== 'pendente') {
      await db.update(schema.reserva).set({ pagamentoStatus: p.status }).where(eq(schema.reserva.id, reserva.id));
    }
  } catch (e) {
    console.error('Webhook Rede: erro no processamento (ignorado)', (e as Error).message);
  }
  return NextResponse.json({ ok: true });
}
