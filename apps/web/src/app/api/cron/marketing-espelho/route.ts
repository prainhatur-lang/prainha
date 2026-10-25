// GET /api/cron/marketing-espelho — de 10 em 10 min manda pro TikTok (caixa de
// entrada) os posts novos do Instagram das casas com "Instagram → TikTok
// automático" ligado no /marketing. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { baseDoApp } from '@/lib/marketing/ligacao';
import { rodarEspelho } from '@/lib/marketing/espelho';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const out = await rodarEspelho(baseDoApp(req.url), Date.now() + 270_000);
  if (Object.keys(out).length) console.log('[marketing-espelho]', JSON.stringify(out));
  return NextResponse.json({ ok: true, casas: out });
}
