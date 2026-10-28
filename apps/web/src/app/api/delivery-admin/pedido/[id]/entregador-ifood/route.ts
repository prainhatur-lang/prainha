// Entregador do iFood pra um pedido do site/WhatsApp (módulo Shipping).
//
//   GET                         → última chamada deste pedido (+ atualiza status/rastreio)
//   POST { acao: 'cotar' }      → preço e tempo da corrida (não chama ninguém)
//   POST { acao: 'chamar', quoteId?, preparoMin?, metodoNaEntrega?, trocoPara? }
//                               → registra o pedido no iFood e o entregador é alocado
//   POST { acao: 'motivos' }    → motivos de cancelamento aceitos AGORA (do iFood)
//   POST { acao: 'cancelar', codigo, motivo }
//
// O pedido continua no painel do mesmo jeito (status, botões, WhatsApp): isto só
// soma o entregador do iFood ao lado do "Saiu pra entrega".

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { configIfood } from '@/lib/ifood-credenciais';
import {
  cotarExterno,
  criarPedidoExterno,
  confirmarPedido,
  motivosCancelamento,
  cancelarPedidoExterno,
  rastreio,
  detalhePedido,
  erroShipping,
} from '@/lib/ifood-shipping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ATIVOS = ['SOLICITADO', 'CONFIRMADO', 'CODIGO', 'A_CAMINHO'];

async function carregar(userId: string, id: string) {
  const [p] = await db.select().from(schema.deliveryPedido).where(eq(schema.deliveryPedido.id, id)).limit(1);
  if (!p) return { erro: NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 }) };
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === p.filialId)) {
    return { erro: NextResponse.json({ error: 'filial não acessível' }, { status: 403 }) };
  }
  const c = await configIfood(p.filialId);
  if (!c.configurada || !c.clientId || !c.clientSecret || !c.merchantId) {
    return { erro: NextResponse.json({ error: 'esta casa não tem credencial do iFood cadastrada' }, { status: 400 }) };
  }
  return { p, c };
}

async function ultima(pedidoId: string) {
  const [e] = await db
    .select()
    .from(schema.ifoodEntrega)
    .where(eq(schema.ifoodEntrega.deliveryPedidoId, pedidoId))
    .orderBy(desc(schema.ifoodEntrega.criadoEm))
    .limit(1);
  return e ?? null;
}

function falha(e: unknown) {
  const x = erroShipping(e);
  return NextResponse.json({ error: x.mensagem, semModulo: x.semModulo }, { status: x.status });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;
  const { id } = await ctx.params;
  const r = await carregar(user.id, id);
  if ('erro' in r) return r.erro;
  const { c } = r;

  const e = await ultima(id);
  if (!e) return NextResponse.json({ entrega: null });
  if (!e.ifoodOrderId || !ATIVOS.includes(e.status)) return NextResponse.json({ entrega: e });

  // Ainda não confirmado: a confirmação logo depois de criar pode ter chegado
  // antes do pedido existir no iFood. Tenta de novo aqui.
  let status = e.status;
  if (status === 'SOLICITADO') {
    try {
      await confirmarPedido(c, e.ifoodOrderId);
      status = 'CONFIRMADO';
    } catch { /* tenta na próxima leitura */ }
  }
  const [det, trk] = await Promise.all([detalhePedido(c, e.ifoodOrderId), rastreio(c, e.ifoodOrderId)]);
  const entregador = det && typeof det === 'object' ? ((det as { delivery?: unknown }).delivery ?? null) : null;
  const [atual] = await db
    .update(schema.ifoodEntrega)
    .set({
      status,
      entregador: { delivery: entregador, tracking: trk } as unknown as Record<string, unknown>,
      atualizadoEm: sql`now()`,
    })
    .where(eq(schema.ifoodEntrega.id, e.id))
    .returning();
  return NextResponse.json({ entrega: atual ?? e, rastreio: trk });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;
  const { id } = await ctx.params;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  const r = await carregar(user.id, id);
  if ('erro' in r) return r.erro;
  const { p, c } = r;

  const end = p.endereco ?? {};
  const temCoord = typeof end.lat === 'number' && typeof end.lng === 'number';

  if (acao === 'cotar' || acao === 'chamar') {
    if (p.tipo !== 'entrega') return NextResponse.json({ error: 'pedido é de retirada' }, { status: 400 });
    if (p.status === 'cancelado' || p.status === 'concluido') {
      return NextResponse.json({ error: `pedido está "${p.status}"` }, { status: 400 });
    }
    if (!temCoord) {
      return NextResponse.json({ error: 'o endereço deste pedido não tem localização (lat/lng) — o iFood precisa dela' }, { status: 400 });
    }
  }

  if (acao === 'cotar') {
    try {
      const q = await cotarExterno(c, c.merchantId, end.lat as number, end.lng as number);
      return NextResponse.json({ cotacao: { ...q, raw: undefined } });
    } catch (e) {
      return falha(e);
    }
  }

  if (acao === 'chamar') {
    const ja = await ultima(id);
    if (ja && ATIVOS.includes(ja.status)) {
      return NextResponse.json({ error: 'já tem entregador do iFood chamado pra este pedido', entrega: ja }, { status: 409 });
    }
    const cep = String(end.cep ?? '').replace(/\D/g, '');
    if (cep.length !== 8 || !end.rua || !end.bairro) {
      return NextResponse.json({ error: 'endereço incompleto (CEP, rua e bairro são obrigatórios no iFood)' }, { status: 400 });
    }
    const itens = await db
      .select()
      .from(schema.deliveryPedidoItem)
      .where(eq(schema.deliveryPedidoItem.pedidoId, id));

    // Pago online (Pix/cartão no site) = não manda pagamento. Na entrega = o
    // entregador cobra: a loja diz como.
    let naEntrega: null | { metodo: 'CREDIT' | 'DEBIT' | 'CASH'; valor: number; trocoPara?: number } = null;
    if (p.pagamentoMetodo === 'na_entrega' && p.pagamentoStatus !== 'pago') {
      const m = String(b?.metodoNaEntrega ?? '');
      if (m !== 'CREDIT' && m !== 'DEBIT' && m !== 'CASH') {
        return NextResponse.json({ error: 'pedido é pago na entrega: diga se é crédito, débito ou dinheiro' }, { status: 400 });
      }
      naEntrega = { metodo: m, valor: Number(p.total), trocoPara: Number(b?.trocoPara ?? 0) || undefined };
    }

    const preparoMin = Math.max(0, Math.min(120, Number(b?.preparoMin ?? (p.status === 'pronto' ? 0 : 15)) || 0));
    const quoteId = typeof b?.quoteId === 'string' ? b.quoteId : undefined;
    const valorCotado = Number(b?.valorCotado ?? NaN);

    try {
      const criado = await criarPedidoExterno(c, c.merchantId, {
        displayId: String(p.numero).slice(-4),
        cliente: { nome: p.clienteNome, telefone: p.clienteTelefone },
        endereco: {
          cep,
          rua: String(end.rua),
          numero: String(end.numero ?? ''),
          complemento: end.complemento,
          referencia: end.referencia,
          bairro: String(end.bairro),
          cidade: String(end.cidade || 'Aracaju'),
          uf: String(end.uf || 'SE'),
          lat: end.lat as number,
          lng: end.lng as number,
        },
        taxaEntrega: Number(p.taxaEntrega),
        preparoSeg: preparoMin * 60,
        quoteId,
        itens: itens.map((i) => ({
          nome: i.nome,
          qtd: i.qtd,
          precoUnit: Number(i.precoUnit),
          complementos: 0,
          total: Number(i.total),
        })),
        pagamentoNaEntrega: naEntrega,
      });

      const [ent] = await db
        .insert(schema.ifoodEntrega)
        .values({
          filialId: p.filialId,
          origem: 'site',
          deliveryPedidoId: p.id,
          ifoodOrderId: criado.id,
          trackingUrl: criado.trackingUrl,
          status: 'SOLICITADO',
          quoteId: quoteId ?? null,
          valor: Number.isFinite(valorCotado) ? valorCotado.toFixed(2) : null,
          cotacao: { preparoMin, naEntrega } as unknown as Record<string, unknown>,
          criadoPor: user.id,
        })
        .returning();

      // A Shipping cria o pedido como PLACED; a loja confirma. Pode ainda não
      // existir no iFood neste instante — o GET tenta de novo.
      let confirmado = false;
      await new Promise((ok) => setTimeout(ok, 1500));
      try {
        await confirmarPedido(c, criado.id);
        confirmado = true;
        await db.update(schema.ifoodEntrega)
          .set({ status: 'CONFIRMADO', atualizadoEm: sql`now()` })
          .where(eq(schema.ifoodEntrega.id, ent.id));
      } catch (e) {
        console.error('[ifood-shipping] confirmar depois de criar:', (e as Error).message);
      }
      console.log('[ifood-shipping] chamado', { pedido: p.id, numero: p.numero, orderId: criado.id, confirmado });
      return NextResponse.json({ ok: true, entrega: { ...ent, status: confirmado ? 'CONFIRMADO' : ent.status } });
    } catch (e) {
      console.error('[ifood-shipping] chamar falhou', { pedido: p.id, erro: (e as Error).message });
      return falha(e);
    }
  }

  if (acao === 'motivos' || acao === 'cancelar') {
    const e = await ultima(id);
    if (!e?.ifoodOrderId || !ATIVOS.includes(e.status)) {
      return NextResponse.json({ error: 'não há entregador do iFood ativo neste pedido' }, { status: 400 });
    }
    try {
      if (acao === 'motivos') {
        const motivos = await motivosCancelamento(c, e.ifoodOrderId);
        return NextResponse.json({ motivos });
      }
      const codigo = Number(b?.codigo);
      if (!Number.isFinite(codigo)) return NextResponse.json({ error: 'escolha o motivo' }, { status: 400 });
      const motivo = typeof b?.motivo === 'string' ? b.motivo : '';
      await cancelarPedidoExterno(c, e.ifoodOrderId, codigo, motivo);
      await db
        .update(schema.ifoodEntrega)
        .set({ status: 'CANCELADO', canceladoMotivo: motivo || String(codigo), canceladoEm: sql`now()`, atualizadoEm: sql`now()` })
        .where(and(eq(schema.ifoodEntrega.id, e.id)));
      console.log('[ifood-shipping] cancelado', { pedido: p.id, orderId: e.ifoodOrderId, codigo });
      return NextResponse.json({ ok: true });
    } catch (err) {
      return falha(err);
    }
  }

  return NextResponse.json({ error: 'ação inválida' }, { status: 400 });
}
