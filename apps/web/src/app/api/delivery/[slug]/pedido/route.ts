// POST /api/delivery/[slug]/pedido — cria o pedido do checkout. Público.
// Tudo revalidado no servidor (preços do banco, frete recalculado, cupom e
// agendamento conferidos). Pagamento é SEMPRE online:
//   - pix: já gera o QR na Cielo e devolve pro cliente pagar
//   - cartao: devolve o token; o cliente paga no passo seguinte
//     (POST /api/delivery/pedido/[token]/pagamento-cartao, com 3DS)
// Se gerar o Pix falhar, o pedido fica pendente e a página de status
// permite tentar de novo (POST /pix) — expira sozinho em 40 min.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { createPixPayment } from '@/lib/pagamento-online';
import { lojaDeliveryPorSlug } from '@/lib/delivery/config';
import { criarPedidoDelivery, marcarDeliveryPedidoPago, type NovoPedidoInput } from '@/lib/delivery/pedido';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loja = await lojaDeliveryPorSlug(slug);
  if (!loja) return NextResponse.json({ error: 'loja não encontrada' }, { status: 404 });

  const b = (await request.json().catch(() => null)) as Partial<NovoPedidoInput> | null;
  if (!b) return NextResponse.json({ error: 'corpo inválido' }, { status: 400 });

  const r = await criarPedidoDelivery({
    filialId: loja.filialId,
    config: loja.config,
    input: {
      clienteNome: String(b.clienteNome ?? ''),
      clienteTelefone: String(b.clienteTelefone ?? ''),
      clienteCpf: typeof b.clienteCpf === 'string' ? b.clienteCpf : undefined,
      tipo: b.tipo as 'entrega' | 'retirada',
      endereco: typeof b.endereco === 'object' && b.endereco ? b.endereco : undefined,
      agendamento: typeof b.agendamento === 'object' && b.agendamento ? b.agendamento : {},
      itens: Array.isArray(b.itens) ? b.itens : [],
      cupomCodigo: typeof b.cupomCodigo === 'string' ? b.cupomCodigo : undefined,
      observacao: typeof b.observacao === 'string' ? b.observacao : undefined,
      pagamentoMetodo: b.pagamentoMetodo as 'pix' | 'cartao' | 'na_entrega',
    },
  });
  if (!r.ok || !r.pedido) {
    return NextResponse.json({ error: r.erro ?? 'não consegui criar o pedido' }, { status: 400 });
  }

  if (b.pagamentoMetodo === 'na_entrega') {
    // Sem dinheiro na frente: confirma agora (vai pra fila do caixa) e o
    // entregador recebe na porta pela maquininha.
    await marcarDeliveryPedidoPago(r.pedido.id, new URL(request.url).origin, { naEntrega: true });
    return NextResponse.json({ ok: true, token: r.pedido.token, numero: r.pedido.numero, totalCentavos: r.pedido.totalCentavos });
  }

  if (b.pagamentoMetodo === 'pix') {
    try {
      const pix = await createPixPayment({
        orderId: `DLV-${r.pedido.numero}`,
        amount: r.pedido.totalCentavos,
        customerName: String(b.clienteNome ?? '').slice(0, 100),
        customerCpf: typeof b.clienteCpf === 'string' ? b.clienteCpf : undefined,
        filialId: r.pedido.filialId,
      });
      await db
        .update(schema.deliveryPedido)
        .set({
          pagamentoStatus: 'aguardando',
          pagamentoId: pix.paymentId,
          pagamentoQrcode: pix.qrCodeString,
          pagamentoQrcodeImg: pix.qrCodeBase64,
          atualizadoEm: sql`now()`,
        })
        .where(eq(schema.deliveryPedido.id, r.pedido.id));
      return NextResponse.json({
        ok: true,
        token: r.pedido.token,
        numero: r.pedido.numero,
        totalCentavos: r.pedido.totalCentavos,
        pix: { qrCodeString: pix.qrCodeString, qrCodeBase64: pix.qrCodeBase64 },
      });
    } catch (e) {
      console.error('delivery: erro gerando Pix:', (e as Error).message);
      // Pedido criado; a página de status oferece "gerar Pix de novo"
      return NextResponse.json({
        ok: true,
        token: r.pedido.token,
        numero: r.pedido.numero,
        totalCentavos: r.pedido.totalCentavos,
        pixErro: 'Não consegui gerar o Pix agora — tente de novo em instantes.',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    token: r.pedido.token,
    numero: r.pedido.numero,
    totalCentavos: r.pedido.totalCentavos,
  });
}
