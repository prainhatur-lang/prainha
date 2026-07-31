// GET /api/cron/match-pix-orfao
// Cron diario: casa Cielo Pix orfa <-> PDV sem NSU/aut (mesma data, mesmo
// valor, candidato unico 1-pra-1). Resolve casos "Pix Manual Outros - Mobile"
// onde o garcom nao captura o NSU no PDV. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { rodarMatchPixOrfao } from '@/lib/match-pix-orfao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const r = await rodarMatchPixOrfao();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
