// GET /api/atendimento/midia/[mensagemId]
// Foto/vídeo/áudio/documento que o cliente mandou no WhatsApp, pro painel do
// atendimento. A equipe assumia a conversa e via só "[imagem]" (laryssa,
// 26/10). Baixa da Meta na hora pelo media_id da mensagem; nada é guardado.
// Login + atendimento.read + a conversa tem que ser de uma casa do usuário.
// A rota /interno/midia (token da loja) continua igual.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { baixarMidia } from '@/lib/atendimento/zap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mensagemId: string }> },
) {
  const { user, error } = await exigirPermApi('atendimento.read');
  if (error) return error;
  const { mensagemId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(mensagemId)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  }

  const [msg] = await db
    .select({
      mediaId: schema.atendimentoMensagem.mediaId,
      filialId: schema.atendimentoConversa.filialId,
    })
    .from(schema.atendimentoMensagem)
    .innerJoin(
      schema.atendimentoConversa,
      eq(schema.atendimentoConversa.id, schema.atendimentoMensagem.conversaId),
    )
    .where(eq(schema.atendimentoMensagem.id, mensagemId))
    .limit(1);
  if (!msg?.mediaId) return NextResponse.json({ error: 'mídia não encontrada' }, { status: 404 });

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === msg.filialId)) {
    return NextResponse.json({ error: 'mídia não encontrada' }, { status: 404 });
  }

  const midia = await baixarMidia(msg.mediaId);
  if (!midia) {
    return NextResponse.json(
      { error: 'a Meta não entregou a mídia (pode ter expirado)' },
      { status: 502 },
    );
  }

  return new NextResponse(new Uint8Array(midia.buffer), {
    headers: {
      'Content-Type': midia.mime,
      // A mídia de uma mensagem não muda; o navegador guarda 1 dia.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
