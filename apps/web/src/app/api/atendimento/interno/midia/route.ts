// GET /api/atendimento/interno/midia?token=<agente_token>&media=<media_id>
// Baixa uma mídia recebida no WhatsApp (imagem/áudio/documento) via Graph e
// devolve os bytes — o painel mostra só "[imagem]" e a equipe ficava cega pro
// comprovante que o cliente manda (caso Fernanda Castro, 02/09). Auth pelo
// token de filial (mesmo padrão dos outros /interno/*): a mídia precisa ser
// de uma conversa de uma filial cujo token bata.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { baixarMidia } from '@/lib/atendimento/zap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const mediaId = url.searchParams.get('media') ?? '';
  if (token.length < 20 || !/^\d{5,30}$/.test(mediaId)) {
    return NextResponse.json({ error: 'payload inválido' }, { status: 400 });
  }

  // A mídia tem que pertencer a uma mensagem de conversa cuja filial tenha
  // este token — media_id avulso não passa.
  const [msg] = await db
    .select({ filialId: schema.atendimentoConversa.filialId })
    .from(schema.atendimentoMensagem)
    .innerJoin(
      schema.atendimentoConversa,
      eq(schema.atendimentoConversa.id, schema.atendimentoMensagem.conversaId),
    )
    .where(eq(schema.atendimentoMensagem.mediaId, mediaId))
    .limit(1);
  if (!msg) return NextResponse.json({ error: 'mídia não encontrada' }, { status: 404 });

  const [fil] = await db
    .select({ agenteToken: schema.filial.agenteToken })
    .from(schema.filial)
    .where(eq(schema.filial.id, msg.filialId))
    .limit(1);
  if (!fil || fil.agenteToken !== token) {
    return NextResponse.json({ error: 'token inválido' }, { status: 403 });
  }

  const midia = await baixarMidia(mediaId);
  if (!midia) return NextResponse.json({ error: 'falha ao baixar da Meta (mídia pode ter expirado)' }, { status: 502 });

  return new NextResponse(new Uint8Array(midia.buffer), {
    headers: { 'Content-Type': midia.mime, 'Cache-Control': 'private, max-age=300' },
  });
}
