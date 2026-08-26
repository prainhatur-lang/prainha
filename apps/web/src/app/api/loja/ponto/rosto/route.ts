// Cadastro do descritor facial (128 floats do face-api.js) de um
// funcionário — a loja manda isso UMA vez, na primeira vez que a pessoa
// aparece na câmera do ponto sem ninguém reconhecido. Nunca recebe foto,
// só o vetor numérico já extraído no navegador.
//
// Auth: mesma assinatura HMAC de /api/loja/ponto (escopo 'ponto').
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

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
  return /^[0-9a-f-]{36}$/i.test(f) && e * 1000 >= Date.now() && confere([f, 'ponto', String(e)], s);
}

const Body = z.object({
  f: z.string(),
  e: z.coerce.number(),
  s: z.string(),
  funcionario_id: z.string().uuid(),
  descriptor: z.array(z.number()).length(128),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400 });
  const { f, e, s, funcionario_id, descriptor } = parsed.data;
  if (!autoriza(f, e, s)) return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });

  const { db, schema } = await import('@concilia/db');
  const { and, eq } = await import('drizzle-orm');

  const [func] = await db
    .select({ id: schema.funcionario.id })
    .from(schema.funcionario)
    .where(and(eq(schema.funcionario.id, funcionario_id), eq(schema.funcionario.filialId, f)))
    .limit(1);
  if (!func) return NextResponse.json({ ok: false, erro: 'funcionário não pertence a esta filial' }, { status: 404 });

  await db
    .update(schema.funcionario)
    .set({ faceDescriptor: descriptor, atualizadoEm: new Date() })
    .where(eq(schema.funcionario.id, funcionario_id));

  return NextResponse.json({ ok: true });
}
