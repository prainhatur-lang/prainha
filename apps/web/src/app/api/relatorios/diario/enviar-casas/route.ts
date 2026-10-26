// POST /api/relatorios/diario/enviar-casas — o dono manda agora, pra quem
// recebe só uma casa (lib/relatorio-casa-envio), os dias que ainda não foram.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { organizacoesDoDono } from '@/lib/relatorio-diario-envio';
import { enviarRelatoriosPorCasa } from '@/lib/relatorio-casa-envio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const orgs = await organizacoesDoDono(guard.user.id);
  if (!orgs.length) return NextResponse.json({ error: 'só o Admin manda o relatório' }, { status: 403 });
  const resultados = await enviarRelatoriosPorCasa('manual');
  return NextResponse.json({ ok: true, resultados });
}
