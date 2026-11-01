// Cardápio do totem de autoatendimento pra loja (vendas-local).
//   GET ?f=<filial>&e=<expira>&s=<assinatura> → { ok, grupos, itens: [{ codigo, grupo, ordem }] }
// Mesma assinatura HMAC do /api/loja/cardapio-destaques (partes [f, e]).

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { GRUPOS_TOTEM, listarTotem } from '@/lib/cardapio-totem';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  const e = Number(sp.get('e') || 0);
  const s = sp.get('s') || '';
  if (!/^[0-9a-f-]{36}$/i.test(f) || !Number.isFinite(e)) {
    return NextResponse.json({ ok: false, error: 'parâmetros' }, { status: 400 });
  }
  if (e * 1000 < Date.now()) return NextResponse.json({ ok: false, error: 'expirado' }, { status: 403 });
  if (!confere([f, String(e)], s)) return NextResponse.json({ ok: false, error: 'assinatura' }, { status: 403 });
  return NextResponse.json({ ok: true, grupos: GRUPOS_TOTEM, itens: await listarTotem(f) });
}
