// Qual ADQUIRENTE a maquininha do garçom usa nesta filial — a LOJA puxa daqui.
//
//   GET ?f=<filial>&e=<expira>&s=<assinatura>  →  { ok, adquirente: 'cielo'|'rede' }
//
// Mesma assinatura HMAC dos outros /api/loja/* (PAGAR_MESA_SECRET, [f, e]).
// A escolha é feita em Configurações → Filiais (campo "Adquirente da
// maquininha"); o vendas-local repassa no /api/config e o app escolhe o módulo
// de pagamento (Lio = Cielo; Rede = Laranjinha Smart).
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

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
    return NextResponse.json({ ok: false, erro: 'parâmetros' }, { status: 400 });
  }
  if (e * 1000 < Date.now()) return NextResponse.json({ ok: false, erro: 'expirado' }, { status: 403 });
  if (!confere([f, String(e)], s)) return NextResponse.json({ ok: false, erro: 'assinatura' }, { status: 403 });

  const [row] = await db
    .select({ adq: schema.filial.adquirenteMaquininha })
    .from(schema.filial)
    .where(eq(schema.filial.id, f))
    .limit(1);
  const adquirente = row?.adq === 'rede' ? 'rede' : 'cielo';
  return NextResponse.json({ ok: true, adquirente });
}
