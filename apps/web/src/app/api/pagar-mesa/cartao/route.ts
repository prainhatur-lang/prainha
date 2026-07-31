// POST /api/pagar-mesa/cartao — cobra a conta da mesa no cartao (3DS ja
// autenticado no browser). Publico, protegido por link ASSINADO.
//
// O servidor da loja e' HTTP e nao pode receber numero de cartao; por isso o
// cliente e' mandado pra ca. O valor NAO vem do que o browser diz: vem dos
// parametros assinados, senao daria pra pagar R$ 1 numa conta de R$ 300.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { createCieloCardPayment, friendlyCieloError } from '@/lib/cielo';
import { lerParams, SEM_3DS_TETO_CENTAVOS } from '@/lib/pagar-mesa';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  // os parametros assinados chegam no corpo (o form manda como extraPayload)
  const sp = new URLSearchParams();
  for (const k of ['f', 'm', 'v', 'r', 'e', 's']) if (b?.[k]) sp.set(k, String(b[k]));
  const p = lerParams(sp);
  if (!p) return NextResponse.json({ error: 'link inválido ou expirado' }, { status: 403 });

  const cardNumber = typeof b?.cardNumber === 'string' ? b.cardNumber.replace(/\D/g, '') : '';
  const cardHolder = typeof b?.cardHolder === 'string' ? b.cardHolder.trim().slice(0, 100) : '';
  const cardExpiration = typeof b?.cardExpiration === 'string' ? b.cardExpiration : '';
  const cardCvv = typeof b?.cardCvv === 'string' ? b.cardCvv.replace(/\D/g, '') : '';
  const brand = typeof b?.brand === 'string' ? b.brand : 'Visa';
  const cpf = typeof b?.cpf === 'string' ? b.cpf : '';
  const paymentType = b?.paymentType === 'DebitCard' ? 'DebitCard' : 'CreditCard';
  const billingAddress =
    b?.billingAddress && typeof b.billingAddress.street === 'string'
      ? {
          street: String(b.billingAddress.street).slice(0, 200),
          number: String(b.billingAddress.number ?? '').slice(0, 20),
          neighborhood: String(b.billingAddress.neighborhood ?? '').slice(0, 100),
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

  // Sem 3DS a casa fica sem garantia contra chargeback. Vale pra valor baixo;
  // acima do teto, exige autenticação. O valor conferido é o do link ASSINADO.
  const autenticado = !!threeDS?.Cavv;
  if (!autenticado && p.valorCentavos > SEM_3DS_TETO_CENTAVOS) {
    return NextResponse.json(
      {
        error:
          `Este cartão não pôde ser autenticado pelo banco, e sem autenticação só aceitamos até ` +
          `${(SEM_3DS_TETO_CENTAVOS / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. ` +
          `Pague via Pix ou chame o garçom com a maquininha.`,
      },
      { status: 402 },
    );
  }

  // cria (ou recupera) a cobranca dessa ref — idempotente por `ref`
  const [existente] = await db
    .select()
    .from(schema.cobrancaMesa)
    .where(eq(schema.cobrancaMesa.ref, p.ref))
    .limit(1);
  if (existente?.status === 'pago') return NextResponse.json({ ok: true, pago: true, jaPago: true });

  let cobrancaId = existente?.id;
  if (!existente) {
    const [nova] = await db
      .insert(schema.cobrancaMesa)
      .values({
        ref: p.ref,
        filialId: p.filialId,
        mesa: p.mesa,
        valorCentavos: p.valorCentavos,
        tipoPagamento: paymentType,
        expiraEm: new Date(p.expira * 1000),
        autenticado3ds: autenticado,
      })
      .returning({ id: schema.cobrancaMesa.id });
    cobrancaId = nova.id;
  }

  try {
    const resultado = await createCieloCardPayment({
      orderId: p.ref,
      amount: p.valorCentavos, // do link assinado, nunca do browser
      customerName: 'Mesa ' + p.mesa,
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

    const pago = resultado.status === 'pago';
    await db
      .update(schema.cobrancaMesa)
      .set({
        status: pago ? 'pago' : 'recusado',
        paymentId: resultado.paymentId,
        bandeira: brand,
        tipoPagamento: paymentType,
        pagoEm: pago ? new Date() : null,
        autenticado3ds: autenticado, // sobrevive à aprovação: importa em disputa
        erro: pago ? null : friendlyCieloError(resultado.returnCode),
      })
      .where(eq(schema.cobrancaMesa.id, cobrancaId!));

    if (pago) return NextResponse.json({ ok: true, pago: true });
    return NextResponse.json({ ok: false, error: friendlyCieloError(resultado.returnCode) }, { status: 402 });
  } catch (e) {
    console.error('Cielo Card erro na mesa:', (e as Error).message);
    await db
      .update(schema.cobrancaMesa)
      .set({ status: 'recusado', erro: (e as Error).message.slice(0, 300) })
      .where(eq(schema.cobrancaMesa.id, cobrancaId!));
    return NextResponse.json(
      { error: 'Não consegui processar o cartão agora. Tente de novo ou pague via Pix.' },
      { status: 502 },
    );
  }
}
