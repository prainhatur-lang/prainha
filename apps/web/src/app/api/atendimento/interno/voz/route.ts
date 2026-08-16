// POST /api/atendimento/interno/voz — utilitário OPERACIONAL de voz da Nina
// (mesma auth do /interno/retomar: token = agente_token de alguma filial).
//
//  { token, acao: 'transcrever', base64, mime? }        -> { texto }
//  { token, acao: 'preview', texto, instrucoes? }       -> { base64 } (ogg/opus)
//  { token, acao: 'enviar_teste', telefone, texto }     -> { ok } (gera e ENVIA)
//
// Usado pelo Claude pra calibrar a voz: transcrever o áudio-exemplo do dono e
// gerar prévias com direções de fala diferentes, que o dono escuta e aprova.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { transcreverAudio } from '@/lib/atendimento/transcrever';
import { gerarAudioNina } from '@/lib/atendimento/voz';
import { enviarAudio } from '@/lib/atendimento/zap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as {
    token?: string;
    acao?: string;
    base64?: string;
    mime?: string;
    texto?: string;
    instrucoes?: string;
  } | null;
  const token = typeof b?.token === 'string' ? b.token : '';
  if (token.length < 20) return NextResponse.json({ error: 'token inválido' }, { status: 403 });
  const [fil] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.agenteToken, token))
    .limit(1);
  if (!fil) return NextResponse.json({ error: 'token inválido' }, { status: 403 });

  if (b?.acao === 'transcrever') {
    if (!b.base64 || b.base64.length > 11_000_000) {
      return NextResponse.json({ error: 'base64 ausente ou grande demais' }, { status: 400 });
    }
    const texto = await transcreverAudio(Buffer.from(b.base64, 'base64'), b.mime ?? 'audio/ogg');
    if (!texto) return NextResponse.json({ error: 'transcrição falhou' }, { status: 502 });
    return NextResponse.json({ texto });
  }

  if (b?.acao === 'preview') {
    const texto = (b.texto ?? '').trim();
    if (!texto) return NextResponse.json({ error: 'texto obrigatório' }, { status: 400 });
    const buf = await gerarAudioNina(texto, b.instrucoes?.trim() || undefined);
    if (!buf) return NextResponse.json({ error: 'TTS falhou' }, { status: 502 });
    return NextResponse.json({ base64: buf.toString('base64') });
  }

  if (b?.acao === 'enviar_teste') {
    const texto = (b.texto ?? '').trim();
    const telefone = ((b as { telefone?: string }).telefone ?? '').replace(/\D/g, '');
    if (!texto || telefone.length < 12) {
      return NextResponse.json({ error: 'texto e telefone (com DDI) obrigatórios' }, { status: 400 });
    }
    const buf = await gerarAudioNina(texto);
    if (!buf) return NextResponse.json({ error: 'TTS falhou' }, { status: 502 });
    const [numero] = await db
      .select({ phoneNumberId: schema.whatsappNumero.phoneNumberId })
      .from(schema.whatsappNumero)
      .where(eq(schema.whatsappNumero.filialId, fil.id))
      .limit(1);
    if (!numero) return NextResponse.json({ error: 'filial sem número' }, { status: 400 });
    const env = await enviarAudio(numero.phoneNumberId, telefone, buf);
    if (env.erro) return NextResponse.json({ error: env.erro }, { status: 502 });
    return NextResponse.json({ ok: true, waMessageId: env.waMessageId });
  }

  return NextResponse.json({ error: 'acao inválida' }, { status: 400 });
}
