// GET  /api/atendimento/conversas/[id] — conversa + mensagens (asc).
//      ?ler=1 zera o contador de não lidas.
// PATCH — { status: 'bot' | 'humano' | 'encerrada' } (assumir/devolver/encerrar).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { asc, eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function carregarConversaDoUsuario(userId: string, id: string) {
  const [conversa] = await db
    .select()
    .from(schema.atendimentoConversa)
    .where(eq(schema.atendimentoConversa.id, id))
    .limit(1);
  if (!conversa) return null;
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === conversa.filialId)) return null;
  return conversa;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('atendimento.read');
  if (error) return error;
  const { id } = await params;

  const conversa = await carregarConversaDoUsuario(user.id, id);
  if (!conversa) return NextResponse.json({ error: 'não encontrada' }, { status: 404 });

  const url = new URL(request.url);
  if (url.searchParams.get('ler') === '1' && conversa.naoLidas > 0) {
    await db
      .update(schema.atendimentoConversa)
      .set({ naoLidas: 0 })
      .where(eq(schema.atendimentoConversa.id, id));
    conversa.naoLidas = 0;
  }

  const mensagens = await db
    .select()
    .from(schema.atendimentoMensagem)
    .where(eq(schema.atendimentoMensagem.conversaId, id))
    .orderBy(asc(schema.atendimentoMensagem.criadoEm))
    .limit(500);

  return NextResponse.json({ conversa, mensagens });
}

const STATUS_VALIDOS = new Set(['bot', 'humano', 'encerrada']);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('atendimento.responder');
  if (error) return error;
  const { id } = await params;

  const conversa = await carregarConversaDoUsuario(user.id, id);
  if (!conversa) return NextResponse.json({ error: 'não encontrada' }, { status: 404 });

  const b = await request.json().catch(() => null);
  const status = typeof b?.status === 'string' ? b.status : '';
  if (!STATUS_VALIDOS.has(status)) {
    return NextResponse.json({ error: 'status inválido' }, { status: 400 });
  }

  await db
    .update(schema.atendimentoConversa)
    .set({
      status,
      // devolver pro bot ou encerrar limpa o motivo da transferência
      ...(status !== 'humano' ? { motivoTransferencia: null } : {}),
      atualizadoEm: sql`now()`,
    })
    .where(eq(schema.atendimentoConversa.id, id));

  return NextResponse.json({ ok: true, status });
}
