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

  // Código de entrega do boy (dono 22/11/2026): o cliente passa pro
  // entregador na porta; só aparece enquanto o pedido está na rua.
  let codigoEntrega: string | null = null;
  if (p.status === 'saiu_entrega' || p.status === 'chegou') {
    const [d] = await db
      .select({ codigo: schema.deliveryDespacho.codigoCliente, entregueEm: schema.deliveryDespacho.entregueEm })
      .from(schema.deliveryDespacho)
      .where(eq(schema.deliveryDespacho.pedidoId, p.id))
      .limit(1);
    if (d && !d.entregueEm) codigoEntrega = d.codigo;
  }

  const aguardandoPix =
    p.status === 'pendente_pagamento' && p.pagamentoMetodo === 'pix' && p.pagamentoStatus === 'aguardando';

  return NextResponse.json({
    numero: p.numero,
    status: p.status,
    tipo: p.tipo,
    clienteNome: p.clienteNome,
    // Pro cartão já vir preenchido. CPF só mascarado (o link é público por
    // token); o servidor do pagamento usa o do pedido.
    clienteCpfMascarado: (() => {
      const d = (p.clienteCpf ?? '').replace(/\D/g, '');
      return d.length === 11 ? `***.***.${d.slice(6, 9)}-${d.slice(9)}` : null;
    })(),
    clienteTelefone: p.clienteTelefone,
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
    codigoEntrega,
    criadoEm: sqlToIso(p.criadoEm),
    // Hora de cada etapa + previsão (dono 22/11/2026: "informar o cliente o
    // tempo"). statusEm vem do trigger; agora = relógio do servidor, pra
    // tela não depender do relógio do celular.
    statusEm: {
      ...(p.pagoEm && !p.statusEm?.pago ? { pago: sqlToIso(p.pagoEm) } : {}),
      ...(p.statusEm ?? {}),
    },
    agora: new Date().toISOString(),
    deslocamentoMin: minutosDeslocamento(p.distanciaKm),
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

/** Tempo de moto até o cliente: ~3 min/km + 5 de saída/estacionar,
 *  entre 10 e 45. Sem distância (pedido sem geocódigo), 15 min. */
function minutosDeslocamento(km: string | null): number {
  const d = Number(km);
  if (!km || !Number.isFinite(d) || d <= 0) return 15;
  return Math.max(10, Math.min(45, Math.round(5 + d * 3)));
}

function sqlToIso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}
