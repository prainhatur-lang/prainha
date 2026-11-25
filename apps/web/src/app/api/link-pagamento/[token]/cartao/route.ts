// POST /api/link-pagamento/[token]/cartao — cobra o link de pagamento avulso.
// Público; quem autoriza é o token do link.
//
// Três regras (dono 25/11/2026: "somente 1 vez, com segurança 3ds"):
//  1. O VALOR vem do banco, nunca do browser.
//  2. 3DS OBRIGATÓRIO em qualquer valor: sem Cavv + ECI de autenticado a
//     cobrança nem vai pra Cielo (aqui não tem teto como no QR da mesa).
//  3. USO ÚNICO: o link é "pego" (aberto → processando) num UPDATE atômico.
//     Aprovou → 'pago' e morre. Recusou → volta a 'aberto' pro cliente tentar
//     outro cartão, até LINK_PG_MAX_TENTATIVAS. Cielo não respondeu →
//     'verificar' (trava até alguém conferir; melhor que cobrar duas vezes).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { createCieloCardPayment, friendlyCieloError, cieloRecusaPorLimite, MSG_SEM_LIMITE } from '@/lib/cielo';
import { registrarCartaoNoOrcamento } from '@/lib/orcamentos-server';
import { eciAutenticado, LINK_PG_MAX_TENTATIVAS, MSG_SEM_3DS, situacaoLinkPagamento } from '@/lib/link-pagamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MSG_SITUACAO: Record<string, string> = {
  pago: 'Este link já foi pago.',
  cancelado: 'Este link foi cancelado. Peça um novo à casa.',
  expirado: 'Este link venceu. Peça um novo à casa.',
  travado: 'Muitas tentativas recusadas — este link foi bloqueado. Peça um novo à casa.',
  processando: 'Já existe um pagamento em andamento neste link. Aguarde um instante.',
  verificar: 'Este pagamento está em conferência. Fale com a casa antes de tentar de novo.',
};

export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const b = await request.json().catch(() => null);

  const [link] = await db
    .select()
    .from(schema.linkPagamento)
    .where(eq(schema.linkPagamento.token, token))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'link inválido' }, { status: 404 });
  const situacao = situacaoLinkPagamento(link);
  if (situacao === 'pago') return NextResponse.json({ ok: true, pago: true, jaPago: true });
  if (situacao !== 'aberto') return NextResponse.json({ error: MSG_SITUACAO[situacao] }, { status: 409 });

  const cardNumber = typeof b?.cardNumber === 'string' ? b.cardNumber.replace(/\D/g, '') : '';
  const cardHolder = typeof b?.cardHolder === 'string' ? b.cardHolder.trim().slice(0, 100) : '';
  const cardExpiration = typeof b?.cardExpiration === 'string' ? b.cardExpiration : '';
  const cardCvv = typeof b?.cardCvv === 'string' ? b.cardCvv.replace(/\D/g, '') : '';
  const brand = typeof b?.brand === 'string' ? b.brand.slice(0, 30) : 'Visa';
  const cpf = typeof b?.cpf === 'string' ? b.cpf : '';
  const paymentType = b?.paymentType === 'DebitCard' ? 'DebitCard' : 'CreditCard';
  const billingAddress =
    b?.billingAddress && typeof b.billingAddress.street === 'string'
      ? {
          street: String(b.billingAddress.street).slice(0, 200),
          number: String(b.billingAddress.number ?? '').slice(0, 20),
          neighborhood: String(b.billingAddress.neighborhood ?? '').slice(0, 100),
          city: String(b.billingAddress.city ?? '').slice(0, 100),
          state: String(b.billingAddress.state ?? '').slice(0, 2),
          cep: String(b.billingAddress.cep ?? ''),
        }
      : undefined;
  const threeDS =
    b?.threeDS && typeof b.threeDS.Cavv === 'string' && typeof b.threeDS.Eci === 'string'
      ? {
          Cavv: b.threeDS.Cavv as string,
          Eci: b.threeDS.Eci as string,
          Xid: typeof b.threeDS.Xid === 'string' ? b.threeDS.Xid : undefined,
          Version: typeof b.threeDS.Version === 'string' ? b.threeDS.Version : '2',
          ReferenceID: typeof b.threeDS.ReferenceID === 'string' ? b.threeDS.ReferenceID : undefined,
        }
      : undefined;

  if (cardNumber.length < 13 || !cardHolder || !cardExpiration || cardCvv.length < 3) {
    return NextResponse.json({ error: 'dados do cartão incompletos' }, { status: 400 });
  }

  // 3DS obrigatório. Nada vai pra Cielo sem a prova do banco emissor.
  if (!threeDS?.Cavv || !eciAutenticado(threeDS.Eci)) {
    await db
      .update(schema.linkPagamento)
      .set({ erro: `sem 3DS (ECI ${threeDS?.Eci || '—'})` })
      .where(and(eq(schema.linkPagamento.id, link.id), eq(schema.linkPagamento.status, 'aberto')));
    return NextResponse.json({ error: MSG_SEM_3DS, motivo: 'sem3ds' }, { status: 402 });
  }

  // Pega o link: só UM pedido passa daqui, mesmo com dois cliques ou duas abas.
  const [pego] = await db
    .update(schema.linkPagamento)
    .set({
      status: 'processando',
      processandoEm: new Date(),
      tentativas: sql`${schema.linkPagamento.tentativas} + 1`,
    })
    .where(
      and(
        eq(schema.linkPagamento.id, link.id),
        eq(schema.linkPagamento.status, 'aberto'),
        gt(schema.linkPagamento.expiraEm, new Date()),
        lt(schema.linkPagamento.tentativas, LINK_PG_MAX_TENTATIVAS),
      ),
    )
    .returning();
  if (!pego) {
    return NextResponse.json({ error: MSG_SITUACAO.processando }, { status: 409 });
  }

  const valorCentavos = Math.round(Number(pego.valor) * 100);
  const cartaoFinal = cardNumber.slice(-4);

  let resultado: Awaited<ReturnType<typeof createCieloCardPayment>>;
  try {
    resultado = await createCieloCardPayment({
      orderId: `LP${pego.numero}-${pego.tentativas}`,
      amount: valorCentavos, // do banco, nunca do browser
      customerName: (pego.clienteNome || cardHolder).slice(0, 100),
      customerCpf: cpf,
      cardNumber,
      holder: cardHolder,
      expirationDate: cardExpiration,
      securityCode: cardCvv,
      brand,
      installments: 1,
      paymentType,
      threeDS,
      billingAddress,
      filialId: pego.filialId,
    });
  } catch (e) {
    const msg = (e as Error).message || '';
    console.error('Link de pagamento', pego.numero, '— Cielo erro:', msg);
    // "Cielo Card erro: 4xx" = a Cielo recusou o PEDIDO (dado inválido): não
    // cobrou, o link reabre. Qualquer outra falha (queda de rede, 5xx) não diz
    // se cobrou — trava em 'verificar' em vez de arriscar cobrar duas vezes.
    const recusouPedido = /Cielo Card erro: 4\d\d/.test(msg);
    await db
      .update(schema.linkPagamento)
      .set({ status: recusouPedido ? 'aberto' : 'verificar', erro: msg.slice(0, 300), bandeira: brand, cartaoFinal })
      .where(eq(schema.linkPagamento.id, pego.id));
    return NextResponse.json(
      {
        error: recusouPedido
          ? 'Não consegui processar este cartão. Confira os dados ou tente outro cartão.'
          : 'Não tivemos resposta da operadora. NÃO tente de novo: fale com a casa pra conferir se o pagamento passou.',
      },
      { status: 502 },
    );
  }

  if (resultado.status === 'pago') {
    await db
      .update(schema.linkPagamento)
      .set({
        status: 'pago',
        pagoEm: new Date(),
        paymentId: resultado.paymentId,
        tipoPagamento: paymentType,
        bandeira: brand,
        eci: threeDS.Eci.slice(0, 4),
        cartaoFinal,
        erro: null,
      })
      .where(eq(schema.linkPagamento.id, pego.id));
    // Link de orçamento de evento: o link pago JÁ é a baixa (o saldo do evento
    // sai dos links pagos). Aqui só registra o aceite. Falha não desfaz o pago.
    if (pego.orcamentoId) {
      await registrarCartaoNoOrcamento(pego.orcamentoId).catch((e) =>
        console.error('Link de pagamento', pego.numero, '— aceite do orçamento falhou:', e),
      );
    }
    return NextResponse.json({ ok: true, pago: true });
  }

  // 'pendente' com código de sucesso = autorizado mas sem confirmação: não
  // reabre (poderia cobrar de novo). Recusa de verdade reabre o link.
  const rc = String(resultado.returnCode ?? '').trim();
  const incerto = resultado.status === 'pendente' && (rc === '' || rc === '00' || rc === '0' || rc === '4' || rc === '6');
  const erro = incerto
    ? `sem confirmação da Cielo (código ${rc || '—'}) — conferir o pagamento ${resultado.paymentId}`
    : friendlyCieloError(resultado.returnCode);
  await db
    .update(schema.linkPagamento)
    .set({
      status: incerto ? 'verificar' : 'aberto',
      paymentId: resultado.paymentId,
      tipoPagamento: paymentType,
      bandeira: brand,
      cartaoFinal,
      erro,
    })
    .where(eq(schema.linkPagamento.id, pego.id));

  if (incerto)
    return NextResponse.json(
      { error: 'O pagamento ficou sem confirmação. NÃO tente de novo: fale com a casa pra conferir.' },
      { status: 502 },
    );
  if (cieloRecusaPorLimite(resultado.returnCode))
    return NextResponse.json({ ok: false, motivo: 'limite', error: MSG_SEM_LIMITE }, { status: 402 });
  return NextResponse.json({ ok: false, error: erro }, { status: 402 });
}
