// GET /api/delivery/pedido/[token] — status público do pedido (página de
// acompanhamento). Se está aguardando Pix, reconsulta a Cielo aqui mesmo
// (polling do cliente; não depende só do webhook). Também expira pedidos
// pendentes antigos de forma preguiçosa.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { queryPayment } from '@/lib/pagamento-online';
import {
  expirarPedidosPendentes,
  marcarDeliveryPedidoPago,
} from '@/lib/delivery/pedido';
import { MOTIVO_FRETE_LABEL } from '@/lib/delivery/frete';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });
  }

  await expirarPedidosPendentes();

  const [p] = await db
    .select()
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.token, token))
    .limit(1);
  if (!p) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });

  // Pix pendente: reconsulta a Cielo agora
  if (
    p.status === 'pendente_pagamento' &&
    p.pagamentoMetodo === 'pix' &&
    p.pagamentoId &&
    p.pagamentoStatus === 'aguardando'
  ) {
    try {
      const cielo = await queryPayment(p.pagamentoId, p.filialId);
      if (cielo.status === 'pago') {
        const origin = new URL(request.url).origin;
        await marcarDeliveryPedidoPago(p.id, origin);
        p.status = 'pago';
        p.pagamentoStatus = 'pago';
      }
    } catch (e) {
      console.error('delivery: erro consultando Pix:', (e as Error).message);
      // mantém o status atual — o cliente tenta no próximo poll
    }
  }

  const [loja] = await db
    .select({
      nome: schema.filial.nome,
      config: schema.filial.deliveryConfig,
    })
    .from(schema.filial)
    .where(eq(schema.filial.id, p.filialId))
    .limit(1);

  const itens = await db
    .select({
      nome: schema.deliveryPedidoItem.nome,
      qtd: schema.deliveryPedidoItem.qtd,
      precoUnit: schema.deliveryPedidoItem.precoUnit,
      total: schema.deliveryPedidoItem.total,
      obs: schema.deliveryPedidoItem.obs,
      complementos: schema.deliveryPedidoItem.complementos,
    })
    .from(schema.deliveryPedidoItem)
    .where(eq(schema.deliveryPedidoItem.pedidoId, p.id));

  const aguardandoPix =
    p.status === 'pendente_pagamento' && p.pagamentoMetodo === 'pix' && p.pagamentoStatus === 'aguardando';

  return NextResponse.json({
    numero: p.numero,
    status: p.status,
    tipo: p.tipo,
    clienteNome: p.clienteNome,
    agendadoData: p.agendadoData,
    agendadoHora: p.agendadoHora,
    asap: p.asap,
    endereco: p.endereco,
    subtotal: p.subtotal,
    taxaEntrega: p.taxaEntrega,
    desconto: p.desconto,
    total: p.total,
    freteGratisMotivo: p.freteGratisMotivo,
    freteGratisLabel: p.freteGratisMotivo ? MOTIVO_FRETE_LABEL[p.freteGratisMotivo] : null,
    cupomCodigo: p.cupomCodigo,
    observacao: p.observacao,
    canceladoMotivo: p.canceladoMotivo,
    criadoEm: sqlToIso(p.criadoEm),
    pagamento: {
      metodo: p.pagamentoMetodo,
      status: p.pagamentoStatus,
      qrCodeString: aguardandoPix ? p.pagamentoQrcode : null,
      qrCodeBase64: aguardandoPix ? p.pagamentoQrcodeImg : null,
    },
    itens,
    loja: loja
      ? {
          nome: loja.config?.titulo ?? loja.nome,
          slug: loja.config?.slug ?? null,
          whatsapp: loja.config?.whatsapp ?? null,
          tempoPreparoMin: loja.config?.tempoPreparoMin ?? null,
          tempoPreparoMax: loja.config?.tempoPreparoMax ?? null,
          endereco: loja.config?.endereco ?? null,
        }
      : null,
  });
}

function sqlToIso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}
