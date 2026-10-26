// POST /api/contador/impostos/ler?t=<token> — igual ao /api/financeiro/impostos/ler,
// pelo link do contador (sem login). Token em lib/impostos/contador-link.ts.

import { NextResponse } from 'next/server';
import { acessoContador } from '@/lib/impostos/contador-acesso';
import { lerArquivo, reabrirGuia } from '@/lib/impostos/processar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(req: Request) {
  const acesso = await acessoContador(new URL(req.url).searchParams.get('t'));
  if (!acesso) return NextResponse.json({ error: 'link inválido — peça um novo ao Prainha' }, { status: 401 });
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await req.json().catch(() => ({}))) as { guiaId?: string };
    const r = await reabrirGuia(String(j.guiaId ?? ''));
    return NextResponse.json(r.body, { status: r.status });
  }
  if (!ct.includes('multipart/form-data')) return NextResponse.json({ error: 'use multipart/form-data' }, { status: 400 });
  const form = await req.formData();
  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File)) return NextResponse.json({ error: 'envie o arquivo da guia' }, { status: 400 });
  const r = await lerArquivo(arquivo, acesso.usuarioId);
  return NextResponse.json(r.body, { status: r.status });
}
