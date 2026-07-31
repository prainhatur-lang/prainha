// GET /api/cron/no-show-automatico
// Roda a cada 5min: cancela sozinha reserva pendente/confirmada que passou
// da tolerância (20min) sem o cliente chegar, e avisa no WhatsApp. Auth:
// Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { processarNoShowAutomatico } from '@/lib/reservas/no-show';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const r = await processarNoShowAutomatico();
  return NextResponse.json({ ok: true, ...r });
}
