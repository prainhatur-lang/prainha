// POST /api/relatorios/diario/enviar-mes — o dono manda agora o resultado do
// último mês fechado (todas as casas) pros números cadastrados.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { organizacoesDoDono } from '@/lib/relatorio-diario-envio';
import { enviarMesDono } from '@/lib/relatorio-mensal-dono';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const guard = await exigirPermApi('relatorio.read');
  if (guard.error) return guard.error;
  const body = (await req.json().catch(() => null)) as { organizacaoId?: string } | null;
  const orgs = await organizacoesDoDono(guard.user.id);
  const org = (body?.organizacaoId ? orgs.find((o) => o.id === body.organizacaoId) : orgs[0]) ?? null;
  if (!org) return NextResponse.json({ error: 'só o Admin manda o relatório' }, { status: 403 });
  const resultados = await enviarMesDono({ organizacaoId: org.id, origem: 'manual', forcar: true, repetir: true });
  if (!resultados.length) {
    return NextResponse.json({ error: 'Nenhum número cadastrado pra receber.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, resultados });
}
