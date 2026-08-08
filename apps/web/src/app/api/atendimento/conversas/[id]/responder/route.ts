// POST /api/atendimento/conversas/[id]/responder — equipe responde pelo painel.
// Body: { texto }. Valida a janela de 24h do WhatsApp (texto livre só até 24h
// após a última mensagem do cliente). Assumir a conversa é opcional — responder
// não muda o status sozinho (quem quiser pausar a Nina usa o botão Assumir).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { enviarTexto } from '@/lib/atendimento/zap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JANELA_24H_MS = 24 * 3600 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('atendimento.responder');
  if (error) return error;
  const { id } = await params;

  const b = await request.json().catch(() => null);
  const texto = typeof b?.texto === 'string' ? b.texto.trim().slice(0, 4000) : '';
  if (!texto) return NextResponse.json({ error: 'texto obrigatório' }, { status: 400 });

  const [conversa] = await db
    .select()
    .from(schema.atendimentoConversa)
    .where(eq(schema.atendimentoConversa.id, id))
    .limit(1);
  if (!conversa) return NextResponse.json({ error: 'não encontrada' }, { status: 404 });

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === conversa.filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const ultimaCliente = conversa.ultimaMsgClienteEm?.getTime() ?? 0;
  if (Date.now() - ultimaCliente > JANELA_24H_MS) {
    return NextResponse.json(
      {
        error:
          'Fora da janela de 24h do WhatsApp: só dá pra mandar texto livre até 24h após a última mensagem do cliente. Aguarde o cliente escrever de novo.',
      },
      { status: 409 },
    );
  }

  // Numero da filial da conversa (v1: 1 numero por filial)
  const [numero] = await db
    .select({ phoneNumberId: schema.whatsappNumero.phoneNumberId })
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.filialId, conversa.filialId))
    .limit(1);
  if (!numero) {
    return NextResponse.json({ error: 'nenhum número de WhatsApp cadastrado pra filial' }, { status: 400 });
  }

  const envio = await enviarTexto(numero.phoneNumberId, conversa.telefone, texto);
  if (envio.erro && !envio.waMessageId) {
    return NextResponse.json({ error: `falha no envio: ${envio.erro}` }, { status: 502 });
  }

  const [msg] = await db
    .insert(schema.atendimentoMensagem)
    .values({
      conversaId: id,
      waMessageId: envio.waMessageId,
      direcao: 'saida',
      autor: 'equipe',
      autorUsuarioId: user.id,
      tipo: 'texto',
      corpo: texto,
      statusEnvio: envio.erro ? 'erro' : 'enviada',
      erro: envio.erro ?? null,
    })
    .returning();

  await db
    .update(schema.atendimentoConversa)
    .set({ ultimaMsgEm: sql`now()`, atualizadoEm: sql`now()` })
    .where(eq(schema.atendimentoConversa.id, id));

  return NextResponse.json({ ok: true, mensagem: msg });
}
