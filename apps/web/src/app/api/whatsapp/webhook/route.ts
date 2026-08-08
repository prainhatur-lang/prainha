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
    default:
      tipo = 'outro';
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
  if (!registro.deveResponder) return; // humano/fornecedor cuidando

  after(() => processarEntrada({ registro, entrada }));
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
      .returning({ numero: schema.pedidoCompra.numero });
    if (upd.length && from) {
      const msg = acao === 'ped_ok'
        ? `✅ Pedido nº ${upd[0].numero} confirmado. Obrigado!`
        : `Ok, registramos que o pedido nº ${upd[0].numero} não poderá ser atendido. Obrigado pelo retorno.`;
      await enviarTextoWhatsApp(from, msg).catch(() => {});
    }
    return;
  }

  if (acao !== 'confirmar' && acao !== 'cancelar') return;

  // Pre-select pra auditoria saber o status ANTERIOR (o update sobrescreve).
  const [antes] = await db
    .select({ id: schema.reserva.id, status: schema.reserva.status, nome: schema.reserva.clienteNome })
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
    if (from) {
      await enviarTextoWhatsApp(
        from,
        `Tudo bem! Sua reserva foi cancelada e a mesa liberada. Quando quiser, é só reservar de novo. 🙏`,
      ).catch(() => {});
    }
  }
}
