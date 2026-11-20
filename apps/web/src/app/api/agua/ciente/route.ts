// POST /api/agua/ciente { ids: number[] } — "Estou ciente" do aviso em tela
// cheia. Grava quem viu e quando; o aviso volta depois do reaviso (30 min) se
// o problema continuar.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { confirmarAlarmes } from '@/lib/agua';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('agua.read');
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.map((x) => Number(x)) : [];
  try {
    const confirmados = await confirmarAlarmes(ids, user.id);
    return NextResponse.json({ ok: true, confirmados });
  } catch (e) {
    console.error('[agua] ciente falhou', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível confirmar o aviso.' }, { status: 500 });
  }
}
