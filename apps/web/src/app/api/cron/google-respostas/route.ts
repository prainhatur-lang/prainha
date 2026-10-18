// GET /api/cron/google-respostas
// De hora em hora: responde sozinho, com a IA, as avaliações do Google das
// casas ligadas (até 5 por casa por rodada) — ver lib/google-resposta-auto.ts.
// Casa sem ligação com o Google ou com a chave desligada não faz nada.
// Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { responderGoogleSozinho } from '@/lib/google-resposta-auto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const casas = await responderGoogleSozinho();
  if (casas.length) {
    console.log(
      '[google-respostas]',
      casas.map((c) => `${c.nome}: ${c.erro ? `ERRO ${c.erro}` : `${c.respondidas} respondidas, ${c.pendentes} na fila`}`).join(' · '),
    );
  }
  return NextResponse.json({ ok: casas.every((c) => !c.erro), casas });
}
