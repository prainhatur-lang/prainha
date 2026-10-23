// POST /api/atendimento/conversas/[id]/responder-imagem — equipe manda foto pelo painel.
// Body: { link, legenda? } — link https público (ex.: foto em app.prainhabar.com/...).
// Mesma regra do /responder: só dentro da janela de 24h do cliente.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { enviarImagem } from '@/lib/atendimento/zap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JANELA_24H_MS = 24 * 3600 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('atendimento.responder');
  if (error) return error;
  const { id } = await params;

  const b = await request.json().catch(() => null);
  const link = typeof b?.link === 'string' ? b.link.trim() : '';
  const legenda = typeof b?.legenda === 'string' ? b.legenda.trim().slice(0, 1000) : '';
  if (!/^https:\/\/\S+$/.test(link)) {
    return NextResponse.json({ error: 'link https obrigatório' }, { status: 400 });
  }

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
      { error: 'Fora da janela de 24h do WhatsApp: aguarde o cliente escrever de novo.' },
      { status: 409 },
    );
  }

  const [numero] = await db
    .select({ phoneNumberId: schema.whatsappNumero.phoneNumberId })
    .from(schema.whatsappNumero)
    .where(eq(schema.whatsappNumero.filialId, conversa.filialId))
    .limit(1);
  if (!numero) {
    return NextResponse.json({ error: 'nenhum número de WhatsApp cadastrado pra filial' }, { status: 400 });
  }

  const envio = await enviarImagem(numero.phoneNumberId, conversa.telefone, link, legenda || undefined);
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
      tipo: 'imagem',
      corpo: legenda ? `${legenda}\n${link}` : link,
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
