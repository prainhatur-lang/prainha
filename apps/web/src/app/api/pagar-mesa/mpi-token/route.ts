// GET /api/pagar-mesa/mpi-token — token do Braspag MPI pro 3DS do cartao.
// Publico, mas so devolve pra um link de cobranca ASSINADO e valido: o token
// nao pode ser pescado por quem monta a URL na mao.

import { NextResponse } from 'next/server';
import { getCieloMpiAccessToken, getCieloMpiPublicConfig } from '@/lib/cielo';
import { lerParams } from '@/lib/pagar-mesa';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const p = lerParams(new URL(request.url).searchParams);
  if (!p) return NextResponse.json({ error: 'link inválido ou expirado' }, { status: 403 });
  try {
    const accessToken = await getCieloMpiAccessToken();
    return NextResponse.json({ accessToken, ...getCieloMpiPublicConfig() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
