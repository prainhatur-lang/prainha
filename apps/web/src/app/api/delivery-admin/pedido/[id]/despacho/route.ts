// Despacho do pedido com boy (dono 22/11/2026).
// GET  → situação do despacho (boy, código, Pix).
// POST { acao: 'despachar', telefone } → cria/atualiza o despacho, manda o
//        link pro boy e o código pro cliente no WhatsApp.
// POST { acao: 'novo_codigo' } → gera código novo pro cliente (boy errou demais).
// Não existe "liberar Pix sem código": o Pix só sai pelo link do boy com o
// código do cliente (lib/delivery/despacho.ts).

import { NextResponse, after } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { emitirNfceDelivery } from '@/lib/delivery/nfce-delivery';
import {
  boyCadastroCompleto,
  despacharPedido,
  freteCheioDoPedido,
  linkDoBoy,
  MAX_TENTATIVAS_CODIGO,
  novoCodigoCliente,
} from '@/lib/delivery/despacho';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function carregar(id: string, userId: string) {
  const [p] = await db.select().from(schema.deliveryPedido).where(eq(schema.deliveryPedido.id, id)).limit(1);
  if (!p) return { erro: NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 }) };
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === p.filialId)) {
    return { erro: NextResponse.json({ error: 'filial não acessível' }, { status: 403 }) };
  }
  return { p };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;
  const { id } = await ctx.params;
  const c = await carregar(id, user.id);
  if (c.erro) return c.erro;
  const [r] = await db
    .select({ d: schema.deliveryDespacho, boy: schema.deliveryEntregador })
    .from(schema.deliveryDespacho)
    .innerJoin(schema.deliveryEntregador, eq(schema.deliveryEntregador.id, schema.deliveryDespacho.entregadorId))
    .where(eq(schema.deliveryDespacho.pedidoId, id))
    .limit(1);
  if (!r) return NextResponse.json({ despacho: null, valorPrevisto: await freteCheioDoPedido(c.p) });
  return NextResponse.json({
    despacho: {
      id: r.d.id,
      link: linkDoBoy(r.d.token),
      valor: Number(r.d.valor),
      codigoCliente: r.d.codigoCliente,
      tentativas: r.d.tentativas,
      bloqueado: r.d.tentativas >= MAX_TENTATIVAS_CODIGO,
      saiuEm: r.d.saiuEm,
      entregueEm: r.d.entregueEm,
      pixStatus: r.d.pixStatus,
      pixErro: r.d.pixErro,
      boy: {
        telefone: r.boy.telefone,
        nome: r.boy.nome,
        pixChave: r.boy.pixChave,
        cadastroCompleto: boyCadastroCompleto(r.boy),
      },
    },
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;
  const { id } = await ctx.params;
  const c = await carregar(id, user.id);
  if (c.erro) return c.erro;
  const b = await request.json().catch(() => null);
  const acao = typeof b?.acao === 'string' ? b.acao : '';

  if (acao === 'despachar') {
    const r = await despacharPedido({ pedidoId: id, telefoneBoy: String(b?.telefone ?? ''), usuarioId: user.id });
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status ?? 400 });
    // Despachou → NFC-e emitida e impressa na loja (dono 22/11/2026).
    after(async () => {
      const n = await emitirNfceDelivery(id, user.email ?? null);
      if (!n.ok && !n.pular) console.error('delivery: NFC-e no despacho falhou:', n.erro);
    });
    return NextResponse.json(r);
  }
  if (acao === 'novo_codigo') {
    const [d] = await db
      .select({ id: schema.deliveryDespacho.id })
      .from(schema.deliveryDespacho)
      .where(eq(schema.deliveryDespacho.pedidoId, id))
      .limit(1);
    if (!d) return NextResponse.json({ error: 'pedido ainda não foi despachado' }, { status: 400 });
    const r = await novoCodigoCliente(d.id);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json(r);
  }
  return NextResponse.json({ error: 'ação inválida' }, { status: 400 });
}
