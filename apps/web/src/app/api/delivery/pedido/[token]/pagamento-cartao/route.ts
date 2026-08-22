// POST /api/delivery/pedido/[token]/pagamento-cartao — cobra o pedido no
// cartão (crédito/débito) com 3DS autenticado no browser. Público (token do
// pedido). Cartão é síncrono: a resposta já diz se pagou.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { createCieloCardPayment, friendlyCieloError } from '@/lib/cielo';
import { marcarDeliveryPedidoPago } from '@/lib/delivery/pedido';
import { SEM_3DS_TETO_CENTAVOS } from '@/lib/pagar-mesa';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });
  }

  const [pedido] = await db
    .select()
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.token, token))
    .limit(1);
  if (!pedido) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });
  if (pedido.status !== 'pendente_pagamento') {
    return NextResponse.json({ error: 'esse pedido não está aguardando pagamento' }, { status: 400 });
  }

  const b = await request.json().catch(() => null);
  const cardNumber = typeof b?.cardNumber === 'string' ? b.cardNumber.replace(/\D/g, '') : '';
  const cardHolder = typeof b?.cardHolder === 'string' ? b.cardHolder.trim().slice(0, 100) : '';
  const cardExpiration = typeof b?.cardExpiration === 'string' ? b.cardExpiration : '';
  const cardCvv = typeof b?.cardCvv === 'string' ? b.cardCvv.replace(/\D/g, '') : '';
  const brand = typeof b?.brand === 'string' ? b.brand : 'Visa';
  const cpf = typeof b?.cpf === 'string' ? b.cpf : '';
  const paymentType = b?.paymentType === 'DebitCard' ? 'DebitCard' : 'CreditCard';
  const billingAddress =
    b?.billingAddress &&
    typeof b.billingAddress.street === 'string' &&
    typeof b.billingAddress.number === 'string' &&
    typeof b.billingAddress.neighborhood === 'string'
      ? {
          street: String(b.billingAddress.street).slice(0, 200),
          number: String(b.billingAddress.number).slice(0, 20),
          neighborhood: String(b.billingAddress.neighborhood).slice(0, 100),
          city: String(b.billingAddress.city ?? '').slice(0, 100),
          state: String(b.billingAddress.state ?? '').slice(0, 2),
          cep: String(b.billingAddress.cep ?? ''),
        }
      : undefined;
  const threeDS =
    b?.threeDS && typeof b.threeDS.Cavv === 'string' && typeof b.threeDS.Eci === 'string'
      ? {
          Cavv: b.threeDS.Cavv as string,
          Eci: b.threeDS.Eci as string,
          Xid: typeof b.threeDS.Xid === 'string' ? b.threeDS.Xid : undefined,
          Version: typeof b.threeDS.Version === 'string' ? b.threeDS.Version : '2',
          ReferenceID: typeof b.threeDS.ReferenceID === 'string' ? b.threeDS.ReferenceID : undefined,
        }
      : undefined;

  if (cardNumber.length < 13 || !cardHolder || !cardExpiration || cardCvv.length < 3) {
    return NextResponse.json({ error: 'dados do cartão incompletos' }, { status: 400 });
  }

  // Mesmo teto da reserva/conta de mesa: sem 3DS não há proteção contra
  // chargeback — acima do teto, só cartão autenticado ou Pix.
  const valorCentavos = Math.round(Number(pedido.total) * 100);
  if (!threeDS?.Cavv && valorCentavos > SEM_3DS_TETO_CENTAVOS) {
    return NextResponse.json(
      {
        error:
          'Esse cartão não pôde ser autenticado pelo banco. Para este valor precisamos da autenticação — ' +
          'tente outro cartão ou pague via Pix.',
      },
      { status: 402 },
    );
  }

  try {
    const resultado = await createCieloCardPayment({
      orderId: `DLV-${pedido.numero}`,
      amount: valorCentavos,
      customerName: pedido.clienteNome,
      customerCpf: cpf,
      cardNumber,
      holder: cardHolder,
      expirationDate: cardExpiration,
      securityCode: cardCvv,
      brand,
      installments: 1,
      paymentType,
      threeDS,
      billingAddress,
      filialId: pedido.filialId,
    });

    await db
      .update(schema.deliveryPedido)
      .set({ pagamentoMetodo: 'cartao', pagamentoId: resultado.paymentId, atualizadoEm: sql`now()` })
      .where(eq(schema.deliveryPedido.id, pedido.id));

    if (resultado.status === 'pago') {
      const origin = new URL(request.url).origin;
      await marcarDeliveryPedidoPago(pedido.id, origin);
      return NextResponse.json({ ok: true, pago: true });
    }

    return NextResponse.json(
      { ok: false, error: friendlyCieloError(resultado.returnCode) },
      { status: 402 },
    );
  } catch (e) {
    console.error('Cielo Card erro no delivery:', (e as Error).message);
    return NextResponse.json(
      { error: 'Não consegui processar o cartão agora. Tente de novo ou pague via Pix.' },
      { status: 502 },
    );
  }
}
