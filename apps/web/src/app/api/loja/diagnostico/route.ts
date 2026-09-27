// DIAGNÓSTICO DO SERVIDOR DA LOJA → NUVEM. O vendas-local lê o log de sistema
// do Windows (desligamento limpo/inesperado, queda de energia Kernel-Power 41,
// reinício por update 1074, suspensão, cabo de rede) + config de energia e
// manda aqui a cada 6 h e logo depois de subir. Fica uma foto por filial em
// loja_diagnostico — é o que explica as quedas de loja_queda.
// Auth: HMAC do PAGAR_MESA_SECRET, assina [f, 'diag', e] (igual cancelamentos).
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db, schema } from '@concilia/db';

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

const Body = z.object({
  f: z.string().regex(/^[0-9a-f-]{36}$/i),
  e: z.coerce.number(),
  s: z.string(),
  dados: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const { f, e, s, dados } = parsed.data;
  if (!(e * 1000 >= Date.now() && confere([f, 'diag', String(e)], s))) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  if (JSON.stringify(dados).length > 500_000) {
    return NextResponse.json({ ok: false, erro: 'diagnóstico grande demais' }, { status: 413 });
  }
  const agora = new Date();
  await db
    .insert(schema.lojaDiagnostico)
    .values({ filialId: f, atualizadoEm: agora, dados })
    .onConflictDoUpdate({ target: schema.lojaDiagnostico.filialId, set: { atualizadoEm: agora, dados } });
  return NextResponse.json({ ok: true });
}
