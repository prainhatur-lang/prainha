// GET /api/loja/certificado?f&e&s&ip=192.168.x.x
// O vendas-local de cada casa (assinatura HMAC dos canais loja↔nuvem, escopo
// 'certificado') informa o IP da rede local e recebe o certificado válido de
// *.loja.prainhabar.com + o nome da casa (bar./tabuara./mar.loja.prainhabar.com).
// Enquanto o certificado não foi emitido, responde { pendente } e a loja
// segue com o autoassinado de sempre.

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { certificadoAtual, publicarEnderecoLoja } from '@/lib/certificado-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ESCOPO = 'certificado';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const u = new URL(request.url);
  const f = String(u.searchParams.get('f') || '');
  const e = Number(u.searchParams.get('e') || 0);
  if (!UUID.test(f) || !Number.isFinite(e)) return NextResponse.json({ error: 'parâmetros' }, { status: 400 });
  if (e * 1000 < Date.now()) return NextResponse.json({ error: 'expirado' }, { status: 403 });
  if (!confere([f, ESCOPO, String(e)], String(u.searchParams.get('s') || ''))) {
    return NextResponse.json({ error: 'assinatura' }, { status: 403 });
  }
  if (!process.env.DESEC_TOKEN || !process.env.DESEC_DOMINIO) {
    return NextResponse.json({ ok: true, pendente: 'certificado ainda não configurado na nuvem' });
  }
  const end = await publicarEnderecoLoja(f, String(u.searchParams.get('ip') || '').trim());
  if (!end.nome) return NextResponse.json({ ok: true, pendente: end.erro });
  const c = await certificadoAtual();
  if (!c) return NextResponse.json({ ok: true, nome: end.nome, pendente: 'certificado ainda não emitido', erro_dns: end.erro });
  return NextResponse.json({ ok: true, nome: end.nome, cert: c.cert_pem, key: c.key_pem, expira: c.expira_em, erro_dns: end.erro });
}
