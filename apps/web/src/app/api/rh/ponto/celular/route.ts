// Ponto pelo celular (24/10/2026) — o lado do gerente, no /rh/ponto:
//  - { filialId, lat, lng, raioM }   → marca o local da casa (lat/lng null = desliga);
//  - { funcionarioId, acao: 'gerar' } → cria (ou troca) o link pessoal;
//  - { funcionarioId, acao: 'revogar' } → tira o link (a pessoa só bate no tablet).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { novoTokenPontoCelular } from '@/lib/rh/ponto-celular';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.union([
  z.object({
    filialId: z.string().uuid(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    raioM: z.number().int().min(30).max(2000),
  }),
  z.object({
    funcionarioId: z.string().uuid(),
    acao: z.enum(['gerar', 'revogar']),
  }),
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'ponto.corrigir');
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const corpo = parsed.data;

  const minhas = new Set(
    (
      await db
        .select({ filialId: schema.usuarioFilial.filialId })
        .from(schema.usuarioFilial)
        .where(eq(schema.usuarioFilial.usuarioId, user.id))
    ).map((x) => x.filialId),
  );

  if ('filialId' in corpo) {
    if (!minhas.has(corpo.filialId)) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
    const ligado = corpo.lat != null && corpo.lng != null;
    await db
      .update(schema.filial)
      .set({
        pontoLat: ligado ? corpo.lat!.toFixed(7) : null,
        pontoLng: ligado ? corpo.lng!.toFixed(7) : null,
        pontoRaioM: corpo.raioM,
      })
      .where(eq(schema.filial.id, corpo.filialId));
    return NextResponse.json({ ok: true });
  }

  const [p] = await db
    .select({ id: schema.funcionario.id, filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, corpo.funcionarioId));
  if (!p) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
  let acesso = minhas.has(p.filialId);
  if (!acesso) {
    const extras = await db
      .select({ filialId: schema.funcionarioFilialExtra.filialId })
      .from(schema.funcionarioFilialExtra)
      .where(and(eq(schema.funcionarioFilialExtra.funcionarioId, p.id)));
    acesso = extras.some((e) => minhas.has(e.filialId));
  }
  if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const token = corpo.acao === 'gerar' ? novoTokenPontoCelular() : null;
  await db
    .update(schema.funcionario)
    .set({ pontoCelularToken: token, atualizadoEm: new Date() })
    .where(eq(schema.funcionario.id, p.id));
  return NextResponse.json({ ok: true, token });
}
