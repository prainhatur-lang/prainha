// POST /api/delivery/pedido/[token]/recebi — o cliente confirma na página do
// pedido que recebeu (dono 22/11/2026: "se ele clicar lá, receber, o boy
// recebe o Pix"). Público pelo token do pedido, como o resto da página.

import { NextResponse } from 'next/server';
import { confirmarRecebidoPeloCliente } from '@/lib/delivery/despacho';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await confirmarRecebidoPeloCliente(token);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true });
}
