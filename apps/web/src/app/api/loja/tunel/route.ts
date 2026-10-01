// Vigia do túnel — a LOJA pergunta se a nuvem alcança ela por fora.
// O vendas-local chama de 2 em 2 min; com vários "não" seguidos ele reinicia o
// serviço do Tailscale da própria máquina (o remédio manual das quedas do
// Funnel de 28/09 a 01/10/2026). A contagem, o intervalo entre tentativas e a
// decisão ficam na loja: daqui só sai a resposta de UMA sonda.
// Assina [FILIAL_ID,'tunel',e] com o PAGAR_MESA_SECRET (mesmo canal do
// diagnóstico). A sonda só bate no caixa_url do cadastro — nunca em URL do
// pedido. Desligar pra todas as casas de uma vez: env VIGIA_TUNEL=off na Vercel.
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { sondarTunelLoja } from '@/lib/caixa-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

function confere(partes: string[], sig: string): boolean {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  const esperada = createHmac('sha256', seg).update(partes.join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(sig || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const Body = z.object({
  f: z.string().regex(/^[0-9a-f-]{36}$/i),
  e: z.coerce.number(),
  s: z.string(),
  // nome da máquina no Tailscale (Self.DNSName) — só pra conferir com o cadastro
  dns: z.string().max(253).nullish(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const { f, e, s, dns } = parsed.data;
  if (!(e * 1000 >= Date.now() && confere([f, 'tunel', String(e)], s))) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  if (String(process.env.VIGIA_TUNEL || '').trim().toLowerCase() === 'off') {
    return NextResponse.json({ ok: true, alcancavel: null, motivo: 'vigia desligado na nuvem (VIGIA_TUNEL=off)', ms: 0 });
  }
  const r = await sondarTunelLoja(f, dns);
  if (r.alcancavel === false) {
    const o = r.outras ? ` · outras casas: ${r.outras.alcancaveis}/${r.outras.total}` : '';
    console.warn(`[tunel] ${f.slice(0, 8)} NÃO alcançável: ${r.motivo}${o}`);
  }
  return NextResponse.json({ ok: true, ...r });
}
