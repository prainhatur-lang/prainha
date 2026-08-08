// POST /api/webhook/cielo — notificação assíncrona da Cielo de mudança de
// status de pagamento. Body: { PaymentId, ChangeType }. Redundante com o
// polling em /reservar/[token]/pagamento/[reservaId] (que já reconsulta a
// Cielo sozinho) — este webhook só acelera, não é o único caminho.
//
// Registrar a URL no Backoffice Cielo > Configurações > Notificação.

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { queryCieloPayment, refundCieloPayment } from '@/lib/cielo';
import { marcarReservaPaga } from '@/lib/reservas/pagamento';
import { marcarOrcamentoEntradaPaga } from '@/lib/orcamentos-server';

/** Entrada de orçamento de evento paga/estornada via webhook. Best-effort. */
async function processarOrcamento(paymentId: string): Promise<void> {
  const [orc] = await db
    .select({ id: schema.orcamentoEvento.id, pagamentoStatus: schema.orcamentoEvento.pagamentoStatus })
    .from(schema.orcamentoEvento)
    .where(eq(schema.orcamentoEvento.pagamentoId, paymentId))
    .limit(1);
  if (!orc) return;
  const cielo = await queryCieloPayment(paymentId);
  if (cielo.status === 'pago' && orc.pagamentoStatus !== 'pago') {
    await marcarOrcamentoEntradaPaga(orc.id);
  } else if (cielo.status !== 'pendente' && cielo.status !== orc.pagamentoStatus) {
    await db
      .update(schema.orcamentoEvento)
      .set({ pagamentoStatus: cielo.status })
      .where(eq(schema.orcamentoEvento.id, orc.id));
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const expected = process.env.CIELO_WEBHOOK_SECRET;
  if (expected) {
    const received = request.headers.get('x-cielo-webhook-secret') || request.headers.get('xcielowebhooksecret');
    if (received !== expected) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  // Sempre responde 200 — a Cielo reenvia (e eventualmente desativa) se
  // não receber sucesso. Erros aqui são best-effort/logados.
  let body: { PaymentId?: string } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const paymentId = body?.PaymentId;
  if (!paymentId) return NextResponse.json({ ok: true });

  try {
    const [reserva] = await db.select().from(schema.reserva).where(eq(schema.reserva.pagamentoId, paymentId)).limit(1);
    if (!reserva) {
      // Não é reserva — pode ser entrada de orçamento de evento.
      await processarOrcamento(paymentId);
      return NextResponse.json({ ok: true });
    }

    const cielo = await queryCieloPayment(paymentId);

    if (cielo.status === 'pago' && reserva.pagamentoStatus !== 'pago') {
      // Reserva cancelada enquanto o Pix estava pendente: dinheiro chegou
      // sem reserva viva pra receber — estorna imediatamente.
      if (reserva.status === 'cancelada') {
        await refundCieloPayment(paymentId);
        await db.update(schema.reserva).set({ pagamentoStatus: 'reembolsado' }).where(eq(schema.reserva.id, reserva.id));
      } else {
        const origin = new URL(request.url).origin;
        await marcarReservaPaga(reserva.id, origin);
      }
    } else if (cielo.status !== reserva.pagamentoStatus && cielo.status !== 'pendente') {
      await db.update(schema.reserva).set({ pagamentoStatus: cielo.status }).where(eq(schema.reserva.id, reserva.id));
    }
  } catch (e) {
    console.error('Webhook Cielo: erro no processamento (ignorado)', (e as Error).message);
  }

  return NextResponse.json({ ok: true });
}
