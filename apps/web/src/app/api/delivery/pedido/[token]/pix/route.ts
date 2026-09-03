// POST /api/delivery/pedido/[token]/pix — (re)gera o Pix de um pedido ainda
// pendente. Idempotente por status: se já tem QR válido, devolve o mesmo;
// se já pagou, avisa. Usado quando a geração falhou na criação ou quando o
// cliente desiste do cartão e troca pro Pix.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { createPixPayment } from '@/lib/pagamento-online';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });
  }

  const [p] = await db
    .select()
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.token, token))
    .limit(1);
  if (!p) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });

  if (p.status !== 'pendente_pagamento') {
    return NextResponse.json({ status: p.status });
  }
  if (p.pagamentoMetodo === 'pix' && p.pagamentoStatus === 'aguardando' && p.pagamentoQrcode) {
    return NextResponse.json({
      status: 'aguardando',
      qrCodeString: p.pagamentoQrcode,
      qrCodeBase64: p.pagamentoQrcodeImg,
      total: p.total,
    });
  }

  try {
    const pix = await createPixPayment({
      orderId: `DLV-${p.numero}`,
      amount: Math.round(Number(p.total) * 100),
      customerName: p.clienteNome,
      customerCpf: p.clienteCpf ?? undefined,
      filialId: p.filialId,
    });
    await db
      .update(schema.deliveryPedido)
      .set({
        pagamentoMetodo: 'pix',
        pagamentoStatus: 'aguardando',
        pagamentoId: pix.paymentId,
        pagamentoQrcode: pix.qrCodeString,
        pagamentoQrcodeImg: pix.qrCodeBase64,
        atualizadoEm: sql`now()`,
      })
      .where(eq(schema.deliveryPedido.id, p.id));
    return NextResponse.json({
      status: 'aguardando',
      qrCodeString: pix.qrCodeString,
      qrCodeBase64: pix.qrCodeBase64,
      total: p.total,
    });
  } catch (e) {
    console.error('delivery: erro gerando Pix (retry):', (e as Error).message);
    return NextResponse.json(
      { error: 'Não consegui gerar o Pix agora. Tente de novo em instantes.' },
      { status: 502 },
    );
  }
}
