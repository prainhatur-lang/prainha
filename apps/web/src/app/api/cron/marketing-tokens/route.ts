// GET /api/cron/marketing-tokens — 1x/dia renova as chaves do Instagram (60
// dias) e do TikTok (24 h + renovação de 365 dias) de todas as casas, pra
// ligação não cair sozinha. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { todasLigacoesRedes } from '@/lib/marketing/ligacao';
import { renovarSePreciso } from '@/lib/marketing/chave';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const saida: Array<{ filialId: string; rede: string; ok: boolean; erro?: string }> = [];
  for (const { filialId, rede, l } of await todasLigacoesRedes()) {
    try {
      await renovarSePreciso(filialId, rede, l, true);
      saida.push({ filialId, rede, ok: true });
    } catch (e) {
      saida.push({ filialId, rede, ok: false, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  console.log('[marketing-tokens]', saida.map((s) => `${s.rede} ${s.filialId.slice(0, 8)} ${s.ok ? 'ok' : s.erro}`).join(' · '));
  return NextResponse.json({ ok: saida.every((s) => s.ok), contas: saida });
}
