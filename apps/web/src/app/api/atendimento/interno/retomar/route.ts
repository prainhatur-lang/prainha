// POST /api/atendimento/interno/retomar — gatilho OPERACIONAL pra destravar
// uma conversa devolvida pra Nina com pergunta pendente (mesmo efeito do
// "Devolver pra Nina" do painel, sem sessão de navegador).
//
// Auth: body.token deve bater com filial.agente_token da filial da conversa
// (mesmo padrão do instalador do agente local — segredo por filial no DB).
// Usado pelo Claude/ops pra intervenções pontuais; não é chamado pela UI.

import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { responderPendenteAposDevolucao } from '@/lib/atendimento/motor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const conversaId = typeof b?.conversaId === 'string' ? b.conversaId : '';
  const token = typeof b?.token === 'string' ? b.token : '';
  if (!/^[0-9a-f-]{36}$/i.test(conversaId) || token.length < 20) {
    return NextResponse.json({ error: 'payload inválido' }, { status: 400 });
  }

  const [conversa] = await db
    .select({ id: schema.atendimentoConversa.id, filialId: schema.atendimentoConversa.filialId })
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

  after(() => responderPendenteAposDevolucao(conversaId));
  return NextResponse.json({ ok: true });
}
