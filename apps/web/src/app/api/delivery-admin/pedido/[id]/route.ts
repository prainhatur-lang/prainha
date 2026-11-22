// PATCH /api/delivery-admin/pedido/[id] — avança/cancela um pedido no painel.
// Body: { acao: 'aceitar' | 'pronto' | 'saiu' | 'concluir' | 'cancelar',
//         motivo? }.
// Cancelar pedido já pago tenta o estorno na Cielo (best-effort; se falhar,
// o pedido é cancelado do mesmo jeito e o estorno vira tarefa manual).

import { NextResponse, after } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { ehGerenteDaFilial } from '@/lib/delivery/gerente';
import { randomBytes } from 'node:crypto';
import { diasAtrasBr } from '@/lib/datas';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { refundPayment } from '@/lib/pagamento-online';
import { enviarAtualizacaoReserva } from '@/lib/whatsapp-otp';
import { emitirNfceDelivery } from '@/lib/delivery/nfce-delivery';

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
    de: ['pronto', 'saiu_entrega', 'chegou', 'em_preparo'],
    para: 'concluido',
    aviso: (n) => `Pedido #${n} finalizado. Obrigado pela preferência! 💛`,
  },
  cancelar: {
    de: ['pendente_pagamento', 'pago', 'em_preparo', 'pronto', 'saiu_entrega', 'chegou'],
    para: 'cancelado',
  },
};

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;

  const { id } = await ctx.params;
  const b = await request.json().catch(() => null);
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  if (acao === 'cancelar_concluido') return cancelarConcluido(user, id, b);
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
      const r = await refundPayment(p.pagamentoId, undefined, p.filialId);
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

  // Saiu pra entrega → emite a NFC-e e manda o DANFE pra impressora da loja
  // (dono 22/11/2026). Depois da resposta, nunca segura o despacho.
  if (regra.para === 'saiu_entrega') {
    after(async () => {
      const r = await emitirNfceDelivery(id, user.email ?? null);
      if (!r.ok && !r.pular) console.error('delivery: NFC-e no despacho falhou:', r.erro);
    });
  }

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

function codigoCredito(): string {
  const alfa = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = randomBytes(6);
  let c = '';
  for (let i = 0; i < 6; i++) c += alfa[b[i]! % alfa.length];
  return `CRED-${c}`;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Cancelar pedido já CONCLUÍDO (deu problema depois da entrega) — dono
 *  22/11/2026: 'só supervisor, só gerente pode cancelar ... normalmente vai
 *  gerar um crédito ou devolução do dinheiro'. Destino:
 *   - devolucao: estorna no meio de pagamento (Cielo/Rede/Pix). Se o estorno
 *     automático falhar (ou foi pago na entrega), o pedido é cancelado e a
 *     devolução fica pra fazer à mão — a resposta avisa.
 *   - credito: cria um cupom de valor fixo (CRED-XXXXXX), 1 uso, 90 dias,
 *     no valor pago, e manda o código pro cliente no WhatsApp.
 *   - nenhum: só cancela.
 *  O destino fica escrito no motivo do cancelamento (sem coluna nova). */
async function cancelarConcluido(
  user: { id: string; email?: string | null },
  id: string,
  b: Record<string, unknown> | null,
) {
  const destino = b?.destino;
  if (destino !== 'devolucao' && destino !== 'credito' && destino !== 'nenhum') {
    return NextResponse.json({ error: 'escolha: devolução, crédito ou nenhum' }, { status: 400 });
  }
  const motivoTxt = typeof b?.motivo === 'string' ? b.motivo.trim().slice(0, 200) : '';
  if (!motivoTxt) return NextResponse.json({ error: 'informe o motivo' }, { status: 400 });

  const [p] = await db
    .select()
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.id, id))
    .limit(1);
  if (!p) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });
  if (!(await ehGerenteDaFilial(user.id, p.filialId))) {
    return NextResponse.json(
      { error: 'só gerente ou dono da casa cancela pedido concluído' },
      { status: 403 },
    );
  }
  if (p.status !== 'concluido') {
    return NextResponse.json(
      { error: `pedido está "${p.status}" — só pedido concluído cancela por aqui` },
      { status: 400 },
    );
  }

  const valor = Number(p.total);
  let estorno: 'ok' | 'falhou' | 'manual' | null = null;
  let credito: { codigo: string; validade: string } | null = null;

  if (destino === 'devolucao') {
    if (p.pagamentoStatus === 'pago' && p.pagamentoId) {
      try {
        const r = await refundPayment(p.pagamentoId, undefined, p.filialId);
        if (r.status !== 'reembolsado') throw new Error(r.reason ?? 'negado');
        estorno = 'ok';
      } catch (e) {
        console.error('delivery: estorno (concluído) falhou:', (e as Error).message);
        estorno = 'falhou';
      }
    } else {
      estorno = 'manual';
    }
  } else if (destino === 'credito') {
    const validade = diasAtrasBr(-90);
    for (let t = 0; t < 5 && !credito; t++) {
      const codigo = codigoCredito();
      const ins = await db
        .insert(schema.deliveryCupom)
        .values({
          filialId: p.filialId,
          codigo,
          tipo: 'fixo',
          valor: valor.toFixed(2),
          validadeFim: validade,
          usosMax: 1,
          usosPorCliente: 1,
          primeiraCompraApenas: false,
          ativo: true,
        })
        .onConflictDoNothing()
        .returning({ id: schema.deliveryCupom.id });
      if (ins.length) credito = { codigo, validade };
    }
    if (!credito) return NextResponse.json({ error: 'não consegui gerar o crédito' }, { status: 500 });
  }

  const destinoTxt =
    destino === 'credito'
      ? `crédito ${credito!.codigo} de ${brl(valor)}`
      : destino === 'devolucao'
        ? estorno === 'ok'
          ? `devolução de ${brl(valor)} (estornado)`
          : `devolução de ${brl(valor)} (FAZER À MÃO)`
        : 'sem crédito nem devolução';
  const quem = user.email ?? 'gerente';

  await db
    .update(schema.deliveryPedido)
    .set({
      status: 'cancelado',
      atualizadoEm: sql`now()`,
      canceladoMotivo: `${motivoTxt} — após concluído, por ${quem}: ${destinoTxt}`.slice(0, 500),
      ...(estorno === 'ok' ? { pagamentoStatus: 'reembolsado' as const } : {}),
    })
    .where(and(eq(schema.deliveryPedido.id, id), eq(schema.deliveryPedido.status, 'concluido')));

  // Aviso pro cliente — best-effort.
  try {
    const [loja] = await db
      .select({ config: schema.filial.deliveryConfig })
      .from(schema.filial)
      .where(eq(schema.filial.id, p.filialId))
      .limit(1);
    const slug = loja?.config?.slug;
    const site = slug ? ` em https://app.prainhabar.com/delivery/${slug}` : '';
    const [aa, mm, dd] = (credito?.validade ?? '').split('-');
    const extra =
      destino === 'credito'
        ? ` Geramos um crédito de ${brl(valor)} pra você: use o código ${credito!.codigo} no próximo pedido${site} (vale até ${dd}/${mm}/${aa}).`
        : destino === 'devolucao'
          ? estorno === 'ok'
            ? ` O valor de ${brl(valor)} foi devolvido no mesmo meio de pagamento.`
            : ` Vamos devolver ${brl(valor)} pra você — entramos em contato pra combinar.`
          : '';
    await enviarAtualizacaoReserva(p.clienteTelefone, {
      nome: p.clienteNome.split(' ')[0] ?? '',
      mensagem: `Seu pedido #${p.numero} foi cancelado: ${motivoTxt}.${extra}`,
    });
  } catch (e) {
    console.error('delivery: aviso WhatsApp (cancelar concluído) falhou:', (e as Error).message);
  }

  return NextResponse.json({
    ok: true,
    status: 'cancelado',
    estorno,
    credito: credito?.codigo ?? null,
  });
}
