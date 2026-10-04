// POST /api/relatorios/diario/enviar — o dono manda o relatório agora (do dia
// escolhido) pros números cadastrados, sem esperar as 07:00.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { enviarRelatorioDiario, organizacoesDoDono } from '@/lib/relatorio-diario-envio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const body = (await req.json().catch(() => null)) as { organizacaoId?: string; dia?: string } | null;
  const orgs = await organizacoesDoDono(guard.user.id);
  const org = (body?.organizacaoId ? orgs.find((o) => o.id === body.organizacaoId) : orgs[0]) ?? null;
  if (!org) return NextResponse.json({ error: 'só o dono manda o relatório' }, { status: 403 });
  const dia = body?.dia && /^\d{4}-\d{2}-\d{2}$/.test(body.dia) ? body.dia : undefined;

  const r = await enviarRelatorioDiario({ organizacaoId: org.id, dia, origem: 'manual' });
  if (!r.resultados.length) {
    return NextResponse.json({ error: 'Nenhum número cadastrado pra receber.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...r });
}
