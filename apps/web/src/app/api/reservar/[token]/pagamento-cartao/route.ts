// POST /api/reservar/[token]/pagamento-cartao — cobra a taxa de reserva no
// cartão (crédito/débito), já com o 3DS (Cavv/Eci) autenticado no browser.
// Público. A reserva já existe (nasceu "aguardando" no /confirmar, junto
// com o Pix) — aqui só tenta uma forma de pagamento alternativa pra ela.
// Diferente do Pix (assíncrono, precisa polling), a Cielo autoriza+captura
// cartão na hora: a resposta desse POST já diz se pagou ou não.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { createCieloCardPayment, friendlyCieloError } from '@/lib/cielo';
import { marcarReservaPaga } from '@/lib/reservas/pagamento';
import { SEM_3DS_TETO_CENTAVOS } from '@/lib/pagar-mesa';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ error: 'token inválido' }, { status: 404 });

  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });

  const b = await request.json().catch(() => null);
  const reservaId = typeof b?.reservaId === 'string' ? b.reservaId : null;
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

  if (!reservaId || cardNumber.length < 13 || !cardHolder || !cardExpiration || cardCvv.length < 3) {
    return NextResponse.json({ error: 'dados do cartão incompletos' }, { status: 400 });
  }

  const [reserva] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, reservaId)).limit(1);
  if (!reserva || reserva.filialId !== filial.id) {
    return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
  }
  if (reserva.pagamentoStatus !== 'aguardando' || !reserva.pagamentoValor) {
    return NextResponse.json({ error: 'essa reserva não está aguardando pagamento' }, { status: 400 });
  }

  // Mesmo teto da conta de mesa: sem 3DS nao ha garantia contra chargeback.
  // Antes o fluxo recusava TODO cartao sem Cavv (inclusive o nao-inscrito, que
  // e' caso legitimo); agora que ele passa, o limite de valor e' o que protege.
  const valorCentavos = Math.round(Number(reserva.pagamentoValor) * 100);
  if (!threeDS?.Cavv && valorCentavos > SEM_3DS_TETO_CENTAVOS) {
    return NextResponse.json(
      {
        error:
          'Esse cartao nao pode ser autenticado pelo banco. Para este valor precisamos da autenticacao — ' +
          'tente outro cartao ou pague via Pix.',
      },
      { status: 402 },
    );
  }

  try {
    const resultado = await createCieloCardPayment({
      orderId: reserva.id,
      amount: valorCentavos,
      customerName: reserva.clienteNome,
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
    });

    await db
      .update(schema.reserva)
      .set({ pagamentoId: resultado.paymentId })
      .where(eq(schema.reserva.id, reserva.id));

    if (resultado.status === 'pago') {
      const origin = new URL(request.url).origin;
      await marcarReservaPaga(reserva.id, origin);
      return NextResponse.json({ ok: true, pago: true });
    }

    return NextResponse.json(
      { ok: false, error: friendlyCieloError(resultado.returnCode) },
      { status: 402 },
    );
  } catch (e) {
    console.error('Cielo Card erro na reserva:', (e as Error).message);
    return NextResponse.json(
      { error: 'Não consegui processar o cartão agora. Tente de novo ou pague via Pix.' },
      { status: 502 },
    );
  }
}
