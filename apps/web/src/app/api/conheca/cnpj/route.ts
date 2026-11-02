// GET /api/conheca/cnpj?c=00000000000000 — público (site /conheca). Preenche o
// cadastro sozinho com razão social, fantasia e cidade da Receita. Só dado
// público; limite simples por IP pra não virar consulta em massa.

import { NextResponse } from 'next/server';
import { validarCnpj } from '@/lib/nfce/documento';
import { buscarCnpjReceita } from '@/lib/receita-cnpj';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const janela = new Map<string, { n: number; ate: number }>();

export async function GET(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0]!.trim() || 'x';
  const agora = Date.now();
  const j = janela.get(ip);
  if (j && j.ate > agora) {
    if (j.n >= 20) return NextResponse.json({ error: 'Muitas consultas. Tente daqui a pouco.' }, { status: 429 });
    j.n++;
  } else {
    janela.set(ip, { n: 1, ate: agora + 10 * 60_000 });
  }

  const c = (new URL(request.url).searchParams.get('c') || '').replace(/\D/g, '');
  if (!validarCnpj(c)) return NextResponse.json({ error: 'CNPJ inválido.' }, { status: 400 });
  const d = await buscarCnpjReceita(c);
  if (!d) return NextResponse.json({ error: 'Não achamos esse CNPJ agora. Preencha à mão.' }, { status: 404 });
  return NextResponse.json(d);
}
