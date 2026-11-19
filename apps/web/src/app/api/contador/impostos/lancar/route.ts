// POST /api/contador/impostos/lancar?t=<token> — igual ao /api/financeiro/impostos/lancar,
// pelo link do contador (sem login). As contas ficam no nome de quem gerou o link.

import { NextResponse } from 'next/server';
import { acessoContadorOuLogado } from '@/lib/impostos/contador-acesso';
import { lancarGuia, type BodyLancar } from '@/lib/impostos/processar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // link assinado, ou a contabilidade logada com 'imposto.enviar'
  const acesso = await acessoContadorOuLogado(new URL(req.url).searchParams.get('t'));
  if (!acesso) return NextResponse.json({ error: 'link inválido — peça um novo ao Prainha' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as BodyLancar;
  const r = await lancarGuia(
    b,
    acesso.usuarioId,
    new Set(acesso.filiais.map((f) => f.id)),
    'Guia de imposto lançada pelo contador (link /contador/impostos)',
  );
  return NextResponse.json(r.body, { status: r.status });
}
