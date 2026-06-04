// POST /api/reservar/[token]/otp — gera e envia codigo OTP no WhatsApp do cliente.
// Publico (reserva sem login). Body: { telefone }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { enviarOtpWhatsApp } from '@/lib/whatsapp-otp';
import { twilioConfigurado, twilioStart } from '@/lib/twilio-verify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normTelefone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let d = v.replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return null;
  if (d.length <= 11) d = '55' + d; // adiciona DDI Brasil
  return d;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ error: 'token inválido' }, { status: 404 });

  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const telefone = normTelefone(body?.telefone);
  if (!telefone) return NextResponse.json({ error: 'WhatsApp inválido' }, { status: 400 });

  // Se o Twilio Verify estiver configurado, ele gera/envia/valida o codigo.
  if (twilioConfigurado()) {
    try {
      await twilioStart(telefone);
      return NextResponse.json({ ok: true, modoTeste: false });
    } catch (e) {
      return NextResponse.json({ error: 'falha ao enviar código: ' + (e as Error).message }, { status: 502 });
    }
  }

  // Rate limit: max 5 codigos por telefone na ultima hora
  const [{ qtd }] = await db
    .select({ qtd: sql<number>`count(*)::int` })
    .from(schema.reservaOtp)
    .where(
      and(
        eq(schema.reservaOtp.filialId, filial.id),
        eq(schema.reservaOtp.telefone, telefone),
        gte(schema.reservaOtp.criadoEm, sql`now() - interval '1 hour'`),
      ),
    );
  if (qtd >= 5) {
    return NextResponse.json({ error: 'muitos códigos pedidos. Tente novamente mais tarde.' }, { status: 429 });
  }

  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.insert(schema.reservaOtp).values({
    filialId: filial.id,
    telefone,
    codigo,
    expiraEm: sql`now() + interval '10 minutes'`,
  });

  try {
    const r = await enviarOtpWhatsApp(telefone, codigo);
    return NextResponse.json({
      ok: true,
      modoTeste: r.modoTeste,
      // Em modo teste (Meta nao configurada), devolve o codigo pra testar o fluxo.
      ...(r.modoTeste ? { codigo } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: 'falha ao enviar WhatsApp: ' + (e as Error).message }, { status: 502 });
  }
}
