// BALANÇO DO DIA vindo da LOJA (vendas-local loopBalancoNuvem, 10 em 10 min).
// Cada POST vira uma linha em balanco_loja; a página /balanco mostra a última
// foto de cada casa e a evolução do dia.
//
// Auth: a MESMA assinatura HMAC dos outros /api/loja/* (PAGAR_MESA_SECRET).
// Assina [f, 'balanco', e].
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { pareceBalanco, salvarBalanco } from '@/lib/balanco';

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

function autoriza(f: string, e: number, s: string) {
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() && confere([f, 'balanco', String(e)], s);
}

const Body = z.object({
  f: z.string(),
  e: z.number(),
  s: z.string(),
  balanco: z.unknown(),
});

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, erro: 'body inválido' }, { status: 400 });
  }
  if (!autoriza(body.f, body.e, body.s)) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  if (!pareceBalanco(body.balanco)) {
    return NextResponse.json({ ok: false, erro: 'balanço sem "agora"' }, { status: 400 });
  }
  try {
    const r = await salvarBalanco(body.f, body.balanco);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ ok: false, erro: err instanceof Error ? err.message : 'erro' }, { status: 500 });
  }
}
