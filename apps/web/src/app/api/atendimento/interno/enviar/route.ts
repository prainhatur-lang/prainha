// POST /api/atendimento/interno/enviar — envia mensagem de TEXTO como EQUIPE
// numa conversa (mesma auth por token de filial dos outros /interno/*).
// Uso operacional: o dono dita a resposta pro Claude e ela sai exata, sem IA
// no meio — registrada no transcript como equipe.
//
//  { token, conversaId, texto } -> { ok, waMessageId }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { enviarTexto } from '@/lib/atendimento/zap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as {
    token?: string;
    conversaId?: string;
    texto?: string;
  } | null;
  const token = typeof b?.token === 'string' ? b.token : '';
  const conversaId = typeof b?.conversaId === 'string' ? b.conversaId : '';
  const texto = (b?.texto ?? '').trim().slice(0, 3000);
  if (token.length < 20 || !/^[0-9a-f-]{36}$/i.test(conversaId) || !texto) {
    return NextResponse.json({ error: 'payload inválido' }, { status: 400 });
  }

  const [conversa] = await db
    .select()
    .from(schema.atendimentoConversa)
    .where(eq(schema.atendimentoConversa.id, conversaId))
    .limit(1);
  if (!conversa) return NextResponse.json({ error: 'não encontrada' }, { status: 404 });

  const [fil] = await db
    .select({ agenteToken: schema.filial.agenteToken })
    .from(schema.filial)
    .where(eq(schema.filial.id, conversa.filialId))
    .limit(1);
  if (!fil || fil.agenteToken !== token) {
    return NextResponse.json({ error: 'token inválido' }, { status: 403 });
  }

  const [numero] = await db
    .select({ phoneNumberId: schema.whatsappNumero.phoneNumberId })
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.filialId, conversa.filialId))
    .limit(1);
  if (!numero) return NextResponse.json({ error: 'filial sem número' }, { status: 400 });

  const envio = await enviarTexto(numero.phoneNumberId, conversa.telefone, texto);
  await db.insert(schema.atendimentoMensagem).values({
    conversaId,
    waMessageId: envio.waMessageId,
    direcao: 'saida',
    autor: 'equipe',
    tipo: 'texto',
    corpo: texto,
    statusEnvio: envio.erro ? 'erro' : 'enviada',
    erro: envio.erro ?? null,
  });
  await db
    .update(schema.atendimentoConversa)
    .set({ ultimaMsgEm: sql`now()`, atualizadoEm: sql`now()` })
    .where(eq(schema.atendimentoConversa.id, conversaId));

  if (envio.erro) return NextResponse.json({ error: envio.erro }, { status: 502 });
  return NextResponse.json({ ok: true, waMessageId: envio.waMessageId });
}
