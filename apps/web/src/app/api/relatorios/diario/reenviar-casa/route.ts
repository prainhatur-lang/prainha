// POST /api/relatorios/diario/reenviar-casa — o dono reenvia dias escolhidos
// pra quem recebe só uma casa, mesmo dia que já foi. Body: { telefone, dias: ["2026-10-18"] }.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { organizacoesDoDono } from '@/lib/relatorio-diario-envio';
import { reenviarDiasCasa } from '@/lib/relatorio-casa-envio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const orgs = await organizacoesDoDono(guard.user.id);
  if (!orgs.length) return NextResponse.json({ error: 'só o dono manda o relatório' }, { status: 403 });
  const b = (await request.json().catch(() => null)) as { telefone?: string; dias?: string[] } | null;
  const telefone = typeof b?.telefone === 'string' ? b.telefone.replace(/\D/g, '') : '';
  const dias = Array.isArray(b?.dias) ? b.dias.filter((x): x is string => typeof x === 'string') : [];
  if (!telefone || !dias.length) return NextResponse.json({ error: 'telefone e dias obrigatórios' }, { status: 400 });
  try {
    const resultados = await reenviarDiasCasa(orgs[0].id, telefone, dias, 'manual');
    return NextResponse.json({ ok: true, resultados });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
