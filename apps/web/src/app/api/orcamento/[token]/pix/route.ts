// Pix da entrada do orçamento de evento (página pública de aceite).
// POST — gera a cobrança Pix na Cielo (idempotente: se já tem uma aguardando,
//        devolve a mesma; se já pagou, diz que pagou).
// GET  — polling do status: reconsulta a Cielo (não depende só do webhook) e,
//        quando confirma, marca pago + aceito.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { createCieloPixPayment, queryCieloPayment } from '@/lib/cielo';
import { marcarOrcamentoEntradaPaga } from '@/lib/orcamentos-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function carregar(token: string) {
  if (!token || token.length < 20) return null;
  const [o] = await db
    .select()
    .from(schema.orcamentoEvento)
    .where(eq(schema.orcamentoEvento.aceiteToken, token))
    .limit(1);
  return o ?? null;
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await carregar(token);
  if (!o) return NextResponse.json({ error: 'orçamento não encontrado' }, { status: 404 });

  if (o.entradaValor == null) {
    return NextResponse.json({ error: 'este orçamento não tem entrada definida' }, { status: 400 });
  }
  if (o.pagamentoStatus === 'pago') {
    return NextResponse.json({ status: 'pago' });
  }
  if (o.pagamentoStatus === 'aguardando' && o.pagamentoQrcode) {
    return NextResponse.json({
      status: 'aguardando',
      qrCodeString: o.pagamentoQrcode,
      qrCodeImg: o.pagamentoQrcodeImg,
      valor: Number(o.entradaValor),
    });
  }

  const amount = Math.round(Number(o.entradaValor) * 100);
  if (!Number.isFinite(amount) || amount < 100) {
    return NextResponse.json({ error: 'valor de entrada inválido' }, { status: 400 });
  }

  try {
    const pix = await createCieloPixPayment({
      orderId: `ORC-${o.numero}-${Math.floor(Math.random() * 100000)}`,
      amount,
      customerName: o.aceiteNome ?? o.clienteNome,
    });
    await db
      .update(schema.orcamentoEvento)
      .set({
        pagamentoStatus: 'aguardando',
        pagamentoId: pix.paymentId,
        pagamentoQrcode: pix.qrCodeString,
        pagamentoQrcodeImg: pix.qrCodeBase64,
        atualizadoEm: sql`now()`,
      })
      .where(eq(schema.orcamentoEvento.id, o.id));
    return NextResponse.json({
      status: 'aguardando',
      qrCodeString: pix.qrCodeString,
      qrCodeImg: pix.qrCodeBase64,
      valor: Number(o.entradaValor),
    });
  } catch (e) {
    console.error('Erro criando Pix do orçamento:', (e as Error).message);
    return NextResponse.json(
      { error: 'não consegui gerar o Pix agora — tenta de novo em instantes' },
      { status: 502 },
    );
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await carregar(token);
  if (!o) return NextResponse.json({ error: 'orçamento não encontrado' }, { status: 404 });

  let status = o.pagamentoStatus;

  if (status === 'aguardando' && o.pagamentoId) {
    try {
      const cielo = await queryCieloPayment(o.pagamentoId);
      if (cielo.status === 'pago') {
        await marcarOrcamentoEntradaPaga(o.id);
        status = 'pago';
      } else if (cielo.status === 'reembolsado') {
        await db
          .update(schema.orcamentoEvento)
          .set({ pagamentoStatus: 'reembolsado' })
          .where(eq(schema.orcamentoEvento.id, o.id));
        status = 'reembolsado';
      }
    } catch (e) {
      console.error('Erro consultando Pix do orçamento:', (e as Error).message);
      // mantém status atual — o cliente tenta no próximo poll
    }
  }

  return NextResponse.json({
    status,
    qrCodeString: o.pagamentoQrcode,
    qrCodeImg: o.pagamentoQrcodeImg,
    valor: o.entradaValor == null ? null : Number(o.entradaValor),
  });
}
