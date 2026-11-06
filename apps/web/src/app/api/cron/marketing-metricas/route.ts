// GET /api/cron/marketing-metricas — de hora em hora grava curtidas, alcance,
// views, salvos e compartilhamentos dos últimos posts do Instagram de cada casa
// em marketing_metrica. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { gravarMetricasInstagram } from '@/lib/marketing/metricas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const casas = await gravarMetricasInstagram(50);
  console.log('[marketing-metricas]', JSON.stringify(casas));
  return NextResponse.json({ ok: true, casas });
}
