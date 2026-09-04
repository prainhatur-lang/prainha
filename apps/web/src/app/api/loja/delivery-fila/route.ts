// A fila de pedidos do site que a LOJA puxa, pro caixa aceitar — mesmo cano
// do iFood, mesma tela.
//
//   GET  ?f=<filial>&e=<expira>&s=<assinatura>   → pedidos pagos ainda não puxados
//   POST ?f=&e=&s=  { pedidoId, acao, motivo? }  → a loja diz o que fez
//
// Sem sessão: a autorização é a mesma assinatura HMAC do /pagar-mesa e do
// /ifood-config, que o vendas-local já tem configurada. Assinatura tem prazo
// e a filial vai assinada — a loja não puxa pedido da casa vizinha.
//
// Só sai pedido PAGO. Pedido pendente de pagamento não existe pro caixa: o
// dinheiro entra antes de ocupar a cozinha.

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { enviarAtualizacaoReserva } from '@/lib/whatsapp-otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Valida ?f&e&s e devolve a filial, ou a resposta de erro. */
function autorizar(request: Request): { filialId: string } | { erro: NextResponse } {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  const e = Number(sp.get('e') || 0);
  const s = sp.get('s') || '';
  if (!f || !Number.isFinite(e)) return { erro: NextResponse.json({ error: 'parâmetros' }, { status: 400 }) };
  if (e * 1000 < Date.now()) return { erro: NextResponse.json({ error: 'expirado' }, { status: 403 }) };
  if (!confere([f, String(e)], s)) return { erro: NextResponse.json({ error: 'assinatura' }, { status: 403 }) };
  return { filialId: f };
}

export async function GET(request: Request) {
  const auth = autorizar(request);
  if ('erro' in auth) return auth.erro;

  const pedidos = await db
    .select({
      id: schema.deliveryPedido.id,
      numero: schema.deliveryPedido.numero,
      tipo: schema.deliveryPedido.tipo,
      clienteNome: schema.deliveryPedido.clienteNome,
      clienteTelefone: schema.deliveryPedido.clienteTelefone,
      endereco: schema.deliveryPedido.endereco,
      total: schema.deliveryPedido.total,
      taxaEntrega: schema.deliveryPedido.taxaEntrega,
      observacao: schema.deliveryPedido.observacao,
      agendadoData: schema.deliveryPedido.agendadoData,
      agendadoHora: schema.deliveryPedido.agendadoHora,
      pagoEm: schema.deliveryPedido.pagoEm,
      // 'na_entrega' = o entregador recebe na porta (a loja marca pago_online=false)
      pagamentoMetodo: schema.deliveryPedido.pagamentoMetodo,
      // CPF do checkout: a NFC-e da entrega já sai com ele
      clienteCpf: schema.deliveryPedido.clienteCpf,
    })
    .from(schema.deliveryPedido)
    .where(and(
      eq(schema.deliveryPedido.filialId, auth.filialId),
      eq(schema.deliveryPedido.status, 'pago'),
      isNull(schema.deliveryPedido.enviadoLojaEm),
    ))
    .orderBy(asc(schema.deliveryPedido.pagoEm))
    .limit(20);

  if (pedidos.length === 0) return NextResponse.json({ ok: true, pedidos: [] });

  // O código do PDV vem do item do cardápio (que nasce de um produto do
  // salão): sem ele a loja não sabe o que mandar pra cozinha e cairia na
  // busca por nome, que erra em cardápio com nomes parecidos.
  const itens = await db
    .select({
      pedidoId: schema.deliveryPedidoItem.pedidoId,
      codigoPdv: schema.produtoVariante.codigoExterno,
      nome: schema.deliveryPedidoItem.nome,
      qtd: schema.deliveryPedidoItem.qtd,
      precoUnit: schema.deliveryPedidoItem.precoUnit,
      total: schema.deliveryPedidoItem.total,
      obs: schema.deliveryPedidoItem.obs,
      // Acompanhamentos escolhidos no wizard — vão pra comanda junto, senão
      // a cozinha monta o prato errado.
      complementos: schema.deliveryPedidoItem.complementos,
    })
    .from(schema.deliveryPedidoItem)
    .leftJoin(schema.deliveryItem, eq(schema.deliveryItem.id, schema.deliveryPedidoItem.itemId))
    .leftJoin(schema.produtoVariante, eq(schema.produtoVariante.id, schema.deliveryItem.varianteId))
    .where(sql`${schema.deliveryPedidoItem.pedidoId} in ${sql`(${sql.join(pedidos.map((p) => sql`${p.id}`), sql`, `)})`}`);

  return NextResponse.json({
    ok: true,
    pedidos: pedidos.map((p) => ({
      ...p,
      itens: itens.filter((i) => i.pedidoId === p.id),
    })),
  });
}

export async function POST(request: Request) {
  const auth = autorizar(request);
  if ('erro' in auth) return auth.erro;

  const b = await request.json().catch(() => null);
  const pedidoId = typeof b?.pedidoId === 'string' ? b.pedidoId : '';
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  if (!pedidoId || !acao) return NextResponse.json({ error: 'pedidoId e acao' }, { status: 400 });

  // A filial vem da assinatura, não do corpo: uma loja não mexe no pedido da
  // outra nem trocando o id na mão.
  const onde = and(
    eq(schema.deliveryPedido.id, pedidoId),
    eq(schema.deliveryPedido.filialId, auth.filialId),
  );

  if (acao === 'recebido') {
    // A loja puxou: para de oferecer no polling. Ainda não é aceite — o
    // pedido está na fila do caixa.
    await db.update(schema.deliveryPedido).set({ enviadoLojaEm: new Date() }).where(onde);
    return NextResponse.json({ ok: true });
  }

  if (acao === 'aceito') {
    await db
      .update(schema.deliveryPedido)
      .set({ status: 'em_preparo', atualizadoEm: sql`now()` })
      .where(onde);
    return NextResponse.json({ ok: true });
  }

  if (acao === 'recusado') {
    // Pedido pago e recusado precisa de ESTORNO — marca o motivo pra isso
    // aparecer no painel e não passar batido.
    const motivo = typeof b?.motivo === 'string' ? b.motivo.slice(0, 200) : null;
    await db
      .update(schema.deliveryPedido)
      .set({
        status: 'cancelado',
        recusadoEm: new Date(),
        recusaMotivo: motivo,
        atualizadoEm: sql`now()`,
      })
      .where(onde);
    return NextResponse.json({ ok: true });
  }

  if (acao === 'pronto' || acao === 'saiu_entrega' || acao === 'chegou' || acao === 'concluido') {
    const [p] = await db
      .select({
        numero: schema.deliveryPedido.numero,
        status: schema.deliveryPedido.status,
        clienteNome: schema.deliveryPedido.clienteNome,
        clienteTelefone: schema.deliveryPedido.clienteTelefone,
        pagamentoStatus: schema.deliveryPedido.pagamentoStatus,
      })
      .from(schema.deliveryPedido)
      .where(onde)
      .limit(1);
    if (!p) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });
    // 'chegou' depois de 'concluido' (ou repetido) não anda pra trás
    if (p.status === 'concluido' || p.status === 'cancelado' || p.status === acao) {
      return NextResponse.json({ ok: true, repetido: true });
    }
    await db
      .update(schema.deliveryPedido)
      .set({ status: acao, atualizadoEm: sql`now()` })
      .where(onde);
    // Aviso no WhatsApp do cliente pelos toques do ENTREGADOR (saí / cheguei):
    // é o que faz a pessoa descer pra porta com o cartão na mão.
    const naEntrega = p.pagamentoStatus === 'na_entrega';
    const msg =
      acao === 'saiu_entrega'
        ? `Seu pedido #${p.numero} saiu pra entrega! 🛵` + (naEntrega ? ' Pagamento na entrega: cartão na maquininha ou dinheiro.' : '')
        : acao === 'chegou'
          ? `O entregador chegou! 🔔 Pedido #${p.numero} na sua porta.` + (naEntrega ? ' Pode pagar com cartão ou Pix na maquininha.' : '')
          : null;
    if (msg) {
      try {
        await enviarAtualizacaoReserva(p.clienteTelefone, { nome: p.clienteNome.split(' ')[0], mensagem: msg });
      } catch (e) {
        console.error('delivery-fila: WhatsApp (' + acao + '):', (e as Error).message);
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (acao === 'pago_entrega') {
    // O entregador recebeu na porta (maquininha ou dinheiro): o pedido passa a
    // constar como pago — o status da rota não muda (chegou → concluído).
    await db
      .update(schema.deliveryPedido)
      .set({ pagamentoStatus: 'pago', pagoEm: new Date(), atualizadoEm: sql`now()` })
      .where(onde);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'ação desconhecida' }, { status: 400 });
}
