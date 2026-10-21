// GET /api/cron/marketing-publicar — de 5 em 5 min publica os posts agendados
// da tela /marketing → Publicar que já venceram e termina os Reels que o
// Instagram ainda estava processando. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { baseDoApp } from '@/lib/marketing/ligacao';
import { postsPendentes, processarPost } from '@/lib/marketing/publicar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const fimDoPedido = Date.now() + 250_000;
  const base = baseDoApp(req.url);
  const saida: Array<{ id: string; status: string }> = [];
  for (const id of await postsPendentes()) {
    const resta = fimDoPedido - Date.now();
    if (resta < 40_000) break;
    try {
      const p = await processarPost(id, base, { ateMs: Date.now() + Math.min(resta - 20_000, 180_000) });
      if (p) saida.push({ id, status: p.status });
    } catch (e) {
      console.error('[marketing-publicar]', id, e instanceof Error ? e.message : String(e));
      saida.push({ id, status: 'falhou' });
    }
  }
  if (saida.length) console.log('[marketing-publicar]', saida.map((s) => `${s.id.slice(0, 8)} ${s.status}`).join(' · '));
  return NextResponse.json({ ok: true, posts: saida });
}
