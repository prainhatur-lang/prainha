// Pix do vale-presente (página pública /presente/[token]).
// POST — garante a cobrança Pix (idempotente).
// GET  — polling: reconsulta a adquirente e marca pago quando confirmou.

import { NextResponse } from 'next/server';
import { valePorToken, garantirPixVale, atualizarPagamentoVale } from '@/lib/vale-presente';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function resposta(v: Awaited<ReturnType<typeof valePorToken>> & object) {
  return {
    status: v.status,
    qrCodeString: v.status === 'aguardando' ? v.pagamentoQrcode : null,
    qrCodeImg: v.status === 'aguardando' ? v.pagamentoQrcodeImg : null,
    total: Number(v.total),
  };
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await valePorToken(token);
  if (!v) return NextResponse.json({ error: 'vale não encontrado' }, { status: 404 });
  try {
    return NextResponse.json(resposta(await garantirPixVale(v)));
  } catch (e) {
    console.error('[presente] Pix falhou:', (e as Error).message);
    return NextResponse.json({ error: 'não consegui gerar o Pix agora — tenta de novo em instantes' }, { status: 502 });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await valePorToken(token);
  if (!v) return NextResponse.json({ error: 'vale não encontrado' }, { status: 404 });
  return NextResponse.json(resposta(await atualizarPagamentoVale(v)));
}
