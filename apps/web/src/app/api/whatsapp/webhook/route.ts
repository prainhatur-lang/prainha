// Webhook do WhatsApp Cloud API (Meta).
//  GET  — verificação do webhook (Meta manda hub.challenge na configuração).
//  POST — eventos:
//    1. Botões de RESPOSTA RÁPIDA (reserva confirmar/cancelar, pedido
//       ped_ok/ped_nao) — fluxo original, inalterado.
//    2. Mensagens comuns (texto/áudio/mídia) — atendimento da Nina, quando o
//       phone_number_id está em whatsapp_numero com atendente_ativo. O
//       registro roda antes do 200 (dedupe garantido); a resposta da IA roda
//       depois, via after() (a Meta exige 200 rápido).
//    3. value.statuses — atualiza entrega/leitura das mensagens enviadas.
//
// Env: WHATSAPP_WEBHOOK_VERIFY_TOKEN (qualquer string secreta que você define
// e repete na configuração do webhook na Meta).

import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { enviarTextoWhatsApp } from '@/lib/whatsapp-otp';
import { registrarAlteracoesReserva } from '@/lib/reservas/alteracoes';
import { estornarReservaSePago } from '@/lib/reservas/estorno';
import { dadosFaturamentoTexto, perguntaFaturamento } from '@/lib/dados-faturamento';
import { enviarTexto } from '@/lib/atendimento/zap';
import {
  registrarEntrada,
  processarEntrada,
  registrarStatusEnvio,
  type EntradaWebhook,
} from '@/lib/atendimento/motor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Debounce (6s) + IA + envio rodam no after() — precisa de folga além dos 10s default.
export const maxDuration = 60;

// --- Verificação (Meta chama no setup) ---
// Token de verificacao: usa a env se setada, senao um padrao (so serve pro
// handshake de setup do webhook — nao protege dados; os eventos sao validados
// pelo token secreto da reserva no payload).
const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'prainha_zap_2026';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const verifyToken = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && verifyToken && verifyToken === VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 });
  }
  return new NextResponse('forbidden', { status: 403 });
}

// --- Eventos ---
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // sempre 200 pra Meta nao reenfileirar
  }

  try {
    const entries = (body as { entry?: unknown[] })?.entry ?? [];
    for (const entry of entries) {
      const changes = (entry as { changes?: unknown[] })?.changes ?? [];
      for (const change of changes) {
        const value = (change as {
          value?: {
            metadata?: { phone_number_id?: string; display_phone_number?: string };
            contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
            messages?: unknown[];
            statuses?: Array<{ id?: string; status?: string; errors?: Array<{ title?: string; message?: string }> }>;
          };
        })?.value;

        // Status de entrega/leitura das mensagens que enviamos
        for (const st of value?.statuses ?? []) {
          if (!st.id || !st.status) continue;
          const erro = st.errors?.[0] ? `${st.errors[0].title ?? ''} ${st.errors[0].message ?? ''}`.trim() : null;
          await registrarStatusEnvio(st.id, st.status, erro).catch(() => {});
        }

        const mensagens = value?.messages ?? [];
        for (const m of mensagens) {
          const msg = m as {
            id?: string;
            from?: string;
            type?: string;
            text?: { body?: string };
            audio?: { id?: string };
            image?: { id?: string; caption?: string };
            video?: { id?: string; caption?: string };
            document?: { id?: string; caption?: string; filename?: string };
            sticker?: { id?: string };
            reaction?: { message_id?: string; emoji?: string };
            button?: { payload?: string; text?: string };
            interactive?: { button_reply?: { id?: string } };
          };
          // Resposta de botao de template (quick_reply) chega como type 'button'.
          // Botao interativo (lista/reply) chega como 'interactive'.
          const payload = msg.button?.payload ?? msg.interactive?.button_reply?.id ?? '';
          if (payload) {
            await tratarPayload(payload, msg.from ?? null);
            continue;
          }
          // Mensagem comum -> atendimento da Nina
          await tratarMensagemComum(msg, value?.metadata?.phone_number_id, value?.contacts);
        }
        // Auto-preenche o numero de exibicao (a Meta manda no metadata de todo
        // evento) — poupa depender do painel/Graph pra saber o numero real.
        const meta = value?.metadata;
        if (meta?.phone_number_id && meta.display_phone_number) {
          await db
            .update(schema.whatsappNumero)
            .set({ numeroExibicao: meta.display_phone_number.replace(/\D/g, '').slice(0, 20) })
            .where(
              and(
                eq(schema.whatsappNumero.phoneNumberId, meta.phone_number_id),
                sql`${schema.whatsappNumero.numeroExibicao} IS NULL`,
              ),
            )
            .catch(() => {});
        }
      }
    }
  } catch {
    // engole erros — responder 200 evita reenvio infinito da Meta
  }

  return NextResponse.json({ ok: true });
}

/** Mensagem que nao e' botao: registra e agenda a resposta da Nina. */
async function tratarMensagemComum(
  msg: {
    id?: string;
    from?: string;
    type?: string;
    text?: { body?: string };
    audio?: { id?: string };
    image?: { id?: string; caption?: string };
    video?: { id?: string; caption?: string };
    document?: { id?: string; caption?: string; filename?: string };
    sticker?: { id?: string };
    reaction?: { message_id?: string; emoji?: string };
  },
  phoneNumberId: string | undefined,
  contacts: Array<{ wa_id?: string; profile?: { name?: string } }> | undefined,
): Promise<void> {
  if (!msg.id || !msg.from || !phoneNumberId) return;

  // So numeros cadastrados com atendente ligado entram no fluxo da Nina
  const [numero] = await db
    .select({ filialId: schema.whatsappNumero.filialId, ativo: schema.whatsappNumero.atendenteAtivo })
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.phoneNumberId, phoneNumberId))
    .limit(1);
  if (!numero?.ativo) return;

  let tipo = 'outro';
  let corpo: string | null = null;
  let mediaId: string | null = null;
  switch (msg.type) {
    case 'text':
      tipo = 'texto';
      corpo = msg.text?.body ?? null;
      break;
    case 'audio':
      tipo = 'audio';
      mediaId = msg.audio?.id ?? null;
      break;
    case 'image':
      tipo = 'imagem';
      mediaId = msg.image?.id ?? null;
      corpo = msg.image?.caption ?? null;
      break;
    case 'video':
      tipo = 'video';
      mediaId = msg.video?.id ?? null;
      corpo = msg.video?.caption ?? null;
      break;
    case 'document':
      tipo = 'documento';
      mediaId = msg.document?.id ?? null;
      corpo = msg.document?.caption ?? msg.document?.filename ?? null;
      break;
    case 'sticker':
      tipo = 'outro';
      mediaId = msg.sticker?.id ?? null;
      break;
    case 'reaction':
      // Reação (👍 etc.) na mensagem — registra no transcript, Nina NÃO
      // responde (reagir não pede resposta; ela chutava "áudio" antes).
      tipo = 'reacao';
      corpo = msg.reaction?.emoji ?? '(reação)';
      break;
    default:
      // Guarda o tipo REAL da Meta pra enxergarmos o próximo formato novo.
      tipo = (msg.type ?? 'outro').slice(0, 20);
  }
  if (tipo === 'texto' && !corpo) return;

  const entrada: EntradaWebhook = {
    phoneNumberId,
    filialId: numero.filialId,
    telefone: msg.from,
    nomeCliente: contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? contacts?.[0]?.profile?.name ?? null,
    waMessageId: msg.id,
    tipo,
    corpo,
    mediaId,
  };

  const registro = await registrarEntrada(entrada);
  if (!registro) return; // reentrega (dedupe)

  // Reação não pede resposta — fica só no transcript.
  if (tipo === 'reacao') return;

  if (!registro.deveResponder) {
    // Conversa de fornecedor (ou assumida pela equipe): a Nina não responde,
    // MAS pergunta de dados de faturamento ("qual CNPJ pra tirar o pedido?")
    // tem resposta automática — o Victor da Saraiva ficou 2 dias sem isso.
    if (tipo === 'texto' && corpo && perguntaFaturamento(corpo)) {
      after(() => responderFaturamento(entrada, registro.conversaId));
    }
    return;
  }

  after(() => processarEntrada({ registro, entrada }));
}

/** Responde na hora com os dados de faturamento da filial e registra a
 *  mensagem na conversa (a janela de 24h está aberta — o fornecedor acabou
 *  de escrever). Nunca lança. */
async function responderFaturamento(entrada: EntradaWebhook, conversaId: string): Promise<void> {
  try {
    const dados = await dadosFaturamentoTexto(entrada.filialId);
    if (!dados) return;
    const texto = `${dados}\n\nQualquer outra dúvida, é só falar que a equipe responde por aqui. 🙏`;
    const envio = await enviarTexto(entrada.phoneNumberId, entrada.telefone, texto);
    await db.insert(schema.atendimentoMensagem).values({
      conversaId,
      waMessageId: envio.waMessageId,
      direcao: 'saida',
      autor: 'bot',
      tipo: 'texto',
      corpo: texto,
      statusEnvio: envio.erro ? 'erro' : 'enviada',
      erro: envio.erro ?? null,
    });
    await db
      .update(schema.atendimentoConversa)
      .set({ ultimaMsgEm: sql`now()`, atualizadoEm: sql`now()` })
      .where(eq(schema.atendimentoConversa.id, conversaId));
  } catch (e) {
    console.error('responderFaturamento falhou', e);
  }
}

async function tratarPayload(payload: string, from: string | null) {
  const [acao, token] = payload.split(':');
  if (!token || token.length < 20) return;

  // --- Pedido de compra: fornecedor confirma/recusa (ped_ok / ped_nao). token = pedido.id ---
  if (acao === 'ped_ok' || acao === 'ped_nao') {
    const novo = acao === 'ped_ok' ? 'CONFIRMADO' : 'RECUSADO';
    const upd = await db
      .update(schema.pedidoCompra)
      .set({ status: novo, atualizadoEm: sql`now()` })
      .where(and(eq(schema.pedidoCompra.id, token), sql`${schema.pedidoCompra.status} NOT IN ('CANCELADO')`))
      .returning({ numero: schema.pedidoCompra.numero, filialId: schema.pedidoCompra.filialId });
    if (upd.length && from) {
      // Ao confirmar, já manda os dados de faturamento junto — o fornecedor
      // não precisa perguntar "qual CNPJ pra tirar o pedido?" (Victor/Saraiva
      // ficou 2 dias esperando essa resposta no pedido #9).
      let msg: string;
      if (acao === 'ped_ok') {
        const dados = await dadosFaturamentoTexto(upd[0].filialId).catch(() => null);
        msg = `✅ Pedido nº ${upd[0].numero} confirmado. Obrigado!${dados ? `\n\n${dados}` : ''}`;
      } else {
        msg = `Ok, registramos que o pedido nº ${upd[0].numero} não poderá ser atendido. Obrigado pelo retorno.`;
      }
      await enviarTextoWhatsApp(from, msg).catch(() => {});
    }
    return;
  }

  if (acao !== 'confirmar' && acao !== 'cancelar') return;

  // Pre-select pra auditoria saber o status ANTERIOR (o update sobrescreve).
  const [antes] = await db
    .select({
      id: schema.reserva.id,
      status: schema.reserva.status,
      nome: schema.reserva.clienteNome,
      data: schema.reserva.data,
      hora: schema.reserva.hora,
      pagamentoStatus: schema.reserva.pagamentoStatus,
      pagamentoId: schema.reserva.pagamentoId,
      pagamentoValor: schema.reserva.pagamentoValor,
      filialId: schema.reserva.filialId,
    })
    .from(schema.reserva)
    .where(and(eq(schema.reserva.cancelToken, token), sql`${schema.reserva.status} <> 'cancelada'`))
    .limit(1);
  if (!antes) return;

  if (acao === 'confirmar') {
    await db
      .update(schema.reserva)
      .set({ status: 'confirmada', confirmadaClienteEm: sql`now()`, atualizadoEm: sql`now()` })
      .where(eq(schema.reserva.id, antes.id));
    await registrarAlteracoesReserva(
      antes.id,
      { status: antes.status },
      { status: 'confirmada' },
      { tipo: 'cliente', nome: 'cliente via WhatsApp' },
    );
    if (from) {
      await enviarTextoWhatsApp(
        from,
        `✅ Presença confirmada, ${(antes.nome ?? '').split(' ')[0] || ''}! Te esperamos. 🌅`,
      ).catch(() => {});
    }
  } else {
    await db
      .update(schema.reserva)
      .set({ status: 'cancelada', atualizadoEm: sql`now()` })
      .where(eq(schema.reserva.id, antes.id));
    await registrarAlteracoesReserva(
      antes.id,
      { status: antes.status },
      { status: 'cancelada' },
      { tipo: 'cliente', nome: 'cliente via WhatsApp' },
    );
    // Lounge pago: regra de estorno 48h/24h automática
    const estorno = await estornarReservaSePago({ ...antes, data: String(antes.data) }).catch(() => null);
    if (from) {
      const linhaEstorno =
        estorno == null
          ? ''
          : estorno.percentual === 100
            ? `\n💰 Seu Pix de R$ ${Number(antes.pagamentoValor).toFixed(2)} volta integral (cancelamento com 48h+ de antecedência) — o banco leva alguns dias.`
            : estorno.percentual === 50
              ? `\n💰 Metade da taxa (R$ ${estorno.valorEstornado.toFixed(2)}) volta no seu Pix — cancelamento entre 24h e 48h devolve 50%.`
              : `\nℹ️ Como o cancelamento foi com menos de 24 horas, a taxa do lounge é retida (regra da casa).`;
      await enviarTextoWhatsApp(
        from,
        `Tudo bem! Sua reserva foi cancelada e a mesa liberada. Quando quiser, é só reservar de novo. 🙏${linhaEstorno}`,
      ).catch(() => {});
    }
  }
}
