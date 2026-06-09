// GET /api/cron/lembrete-reserva
// Cron diário (02:47 UTC → 23:47 BRT): manda na VÉSPERA o lembrete pedindo pro
// cliente confirmar a reserva do dia seguinte. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { diasAtrasBr } from '@/lib/datas';
import { processarLembretesReserva } from '@/lib/reservas/lembrete';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const amanha = diasAtrasBr(-1); // YYYY-MM-DD (BRT)
  const r = await processarLembretesReserva(amanha);
  if (!r.configurado) {
    return NextResponse.json({ ok: true, skip: 'WhatsApp lembrete nao configurado', enviados: 0 });
  }
  return NextResponse.json({ ok: true, ...r });
}
