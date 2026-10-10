// GET /api/cron/tripadvisor
// Cron diário (09:45 UTC → 06:45 BRT): lê nota, total e as últimas avaliações
// de cada casa no TripAdvisor (API oficial) e grava a foto do dia — é o que a
// tela /avaliacoes mostra. São 2 consultas pagas por casa por rodada, por isso
// roda 1 vez por dia. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { sincronizarTripadvisor, tripadvisorConfigurado } from '@/lib/tripadvisor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!tripadvisorConfigurado()) {
    return NextResponse.json({ ok: false, error: 'TRIPADVISOR_API_KEY ausente' });
  }

  const casas = await sincronizarTripadvisor();
  console.log(
    '[tripadvisor]',
    casas.map((c) => `${c.nome}: ${c.erro ? `ERRO ${c.erro}` : `${c.nota ?? '-'} (${c.total})`}`).join(' · '),
  );
  return NextResponse.json({ ok: casas.every((c) => !c.erro), casas });
}
