// Webhook do WhatsApp Cloud API (Meta).
//  GET  — verificação do webhook (Meta manda hub.challenge na configuração).
//  POST — eventos. Trata os toques nos botões de RESPOSTA RÁPIDA do lembrete
//         de reserva: payload "confirmar:<token>" / "cancelar:<token>".
//
// Env: WHATSAPP_WEBHOOK_VERIFY_TOKEN (qualquer string secreta que você define
// e repete na configuração do webhook na Meta).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { enviarTextoWhatsApp } from '@/lib/whatsapp-otp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// --- Verificação (Meta chama no setup) ---
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const verifyToken = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && verifyToken && verifyToken === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
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
        const value = (change as { value?: { messages?: unknown[] } })?.value;
        const mensagens = value?.messages ?? [];
        for (const m of mensagens) {
          const msg = m as {
            from?: string;
            type?: string;
            button?: { payload?: string; text?: string };
            interactive?: { button_reply?: { id?: string } };
          };
          // Resposta de botao de template (quick_reply) chega como type 'button'.
          // Botao interativo (lista/reply) chega como 'interactive'.
          const payload = msg.button?.payload ?? msg.interactive?.button_reply?.id ?? '';
          if (!payload) continue;
          await tratarPayload(payload, msg.from ?? null);
        }
      }
    }
  } catch {
    // engole erros — responder 200 evita reenvio infinito da Meta
  }

  return NextResponse.json({ ok: true });
}

async function tratarPayload(payload: string, from: string | null) {
  const [acao, token] = payload.split(':');
  if (!token || token.length < 20) return;
  if (acao !== 'confirmar' && acao !== 'cancelar') return;

  if (acao === 'confirmar') {
    const upd = await db
      .update(schema.reserva)
      .set({ status: 'confirmada', confirmadaClienteEm: sql`now()`, atualizadoEm: sql`now()` })
      .where(and(eq(schema.reserva.cancelToken, token), sql`${schema.reserva.status} <> 'cancelada'`))
      .returning({ nome: schema.reserva.clienteNome });
    if (upd.length && from) {
      await enviarTextoWhatsApp(
        from,
        `✅ Presença confirmada, ${(upd[0].nome ?? '').split(' ')[0] || ''}! Te esperamos. 🌅`,
      ).catch(() => {});
    }
  } else {
    const upd = await db
      .update(schema.reserva)
      .set({ status: 'cancelada', atualizadoEm: sql`now()` })
      .where(and(eq(schema.reserva.cancelToken, token), sql`${schema.reserva.status} <> 'cancelada'`))
      .returning({ nome: schema.reserva.clienteNome });
    if (upd.length && from) {
      await enviarTextoWhatsApp(
        from,
        `Tudo bem! Sua reserva foi cancelada e a mesa liberada. Quando quiser, é só reservar de novo. 🙏`,
      ).catch(() => {});
    }
  }
}
