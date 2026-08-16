// PATCH /api/delivery-admin/pedido/[id] — avança/cancela um pedido no painel.
// Body: { acao: 'aceitar' | 'pronto' | 'saiu' | 'concluir' | 'cancelar',
//         motivo? }.
// Cancelar pedido já pago tenta o estorno na Cielo (best-effort; se falhar,
// o pedido é cancelado do mesmo jeito e o estorno vira tarefa manual).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { refundCieloPayment } from '@/lib/cielo';
import { enviarAtualizacaoReserva } from '@/lib/whatsapp-otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** De onde pra onde cada ação leva (e o aviso que o cliente recebe). */
const TRANSICOES: Record<
  string,
  { de: string[]; para: string; aviso?: (numero: number, tipo: string) => string }
> = {
  aceitar: {
    de: ['pago'],
    para: 'em_preparo',
    aviso: (n) => `Seu pedido #${n} entrou na cozinha! 👩‍🍳`,
  },
  pronto: {
    de: ['pago', 'em_preparo'],
    para: 'pronto',
    aviso: (n, tipo) =>
      tipo === 'retirada'
        ? `Pedido #${n} pronto pra retirada! Estamos te esperando 🌅`
        : `Pedido #${n} pronto — já já sai pra entrega!`,
  },
  saiu: {
    de: ['pronto', 'em_preparo'],
    para: 'saiu_entrega',
    aviso: (n) => `Pedido #${n} saiu pra entrega! 🛵`,
  },
  concluir: {
    de: ['pronto', 'saiu_entrega', 'em_preparo'],
    para: 'concluido',
    aviso: (n) => `Pedido #${n} finalizado. Obrigado pela preferência! 💛`,
  },
  cancelar: {
    de: ['pendente_pagamento', 'pago', 'em_preparo', 'pronto', 'saiu_entrega'],
    para: 'cancelado',
  },
};

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;

  const { id } = await ctx.params;
  const b = await request.json().catch(() => null);
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  const regra = TRANSICOES[acao];
  if (!regra) return NextResponse.json({ error: 'ação inválida' }, { status: 400 });

  const [p] = await db
    .select()
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.id, id))
    .limit(1);
  if (!p) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === p.filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }
  if (!regra.de.includes(p.status)) {
    return NextResponse.json(
      { error: `pedido está "${p.status}" — essa ação não se aplica` },
      { status: 400 },
    );
  }

  let estorno: 'ok' | 'falhou' | null = null;
  if (acao === 'cancelar' && p.pagamentoStatus === 'pago' && p.pagamentoId) {
    try {
      const r = await refundCieloPayment(p.pagamentoId);
      if (r.status !== 'reembolsado') throw new Error(r.reason ?? 'negado pela Cielo');
      estorno = 'ok';
    } catch (e) {
      console.error('delivery: estorno falhou:', (e as Error).message);
      estorno = 'falhou';
    }
  }

  const motivo =
    typeof b?.motivo === 'string' && b.motivo.trim() ? b.motivo.trim().slice(0, 300) : null;

  await db
    .update(schema.deliveryPedido)
    .set({
      status: regra.para,
      atualizadoEm: sql`now()`,
      ...(acao === 'cancelar'
        ? {
            canceladoMotivo: motivo ?? 'Cancelado pela loja',
            ...(estorno === 'ok' ? { pagamentoStatus: 'reembolsado' as const } : {}),
          }
        : {}),
    })
    .where(eq(schema.deliveryPedido.id, id));

  // Aviso no WhatsApp do cliente — best-effort, nunca derruba a ação.
  try {
    const primeiroNome = p.clienteNome.split(' ')[0];
    if (acao === 'cancelar') {
      await enviarAtualizacaoReserva(p.clienteTelefone, {
        nome: primeiroNome,
        mensagem:
          `Seu pedido #${p.numero} foi cancelado${motivo ? `: ${motivo}` : ''}.` +
          (estorno === 'ok' ? ' O valor pago foi estornado.' : ''),
      });
    } else if (regra.aviso) {
      await enviarAtualizacaoReserva(p.clienteTelefone, {
        nome: primeiroNome,
        mensagem: regra.aviso(p.numero, p.tipo),
      });
    }
  } catch (e) {
    console.error('delivery: aviso WhatsApp falhou:', (e as Error).message);
  }

  return NextResponse.json({ ok: true, status: regra.para, estorno });
}
