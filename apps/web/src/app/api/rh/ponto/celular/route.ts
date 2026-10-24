// Ponto pelo celular (24/10/2026) — o lado do gerente, no /rh/ponto:
//  - { filialId, lat, lng, raioM }   → marca o local da casa (lat/lng null = desliga);
//  - { funcionarioId, acao: 'gerar' } → cria (ou troca) o link pessoal;
//  - { funcionarioId, acao: 'revogar' } → tira o link (a pessoa só bate no tablet);
//  - { filialId, cercaId?, nome, pontos, folgaM, funcionarioIds } → cria/edita
//    uma cerca geográfica (polígono do mapa; funcionarioIds null = todos);
//  - { cercaId, acao: 'desativar' } → desliga a cerca (não apaga: batidas
//    antigas guardam o geo_cerca_id).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { novoTokenPontoCelular } from '@/lib/rh/ponto-celular';
import { areaPoligonoM2 } from '@/lib/rh/geo-cerca';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Vertice = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

const Body = z.union([
  z.object({
    filialId: z.string().uuid(),
    cercaId: z.string().uuid().optional(),
    nome: z.string().trim().min(1).max(80),
    pontos: z.array(Vertice).min(3).max(200),
    folgaM: z.number().int().min(0).max(200),
    funcionarioIds: z.array(z.string().uuid()).max(500).nullable(),
  }),
  z.object({
    cercaId: z.string().uuid(),
    acao: z.literal('desativar'),
  }),
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

  if ('pontos' in corpo) {
    if (!minhas.has(corpo.filialId)) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
    const area = areaPoligonoM2(corpo.pontos);
    if (area < 50) return NextResponse.json({ error: 'área pequena demais — desenhe pelo menos 3 pontos afastados' }, { status: 400 });
    if (area > 4_000_000) return NextResponse.json({ error: 'área grande demais (mais de 4 km²)' }, { status: 400 });
    const valores = {
      nome: corpo.nome,
      pontos: corpo.pontos as [number, number][],
      folgaM: corpo.folgaM,
      funcionarioIds: corpo.funcionarioIds?.length ? corpo.funcionarioIds : null,
      atualizadoEm: new Date(),
    };
    if (corpo.cercaId) {
      const r = await db
        .update(schema.pontoCerca)
        .set(valores)
        .where(and(eq(schema.pontoCerca.id, corpo.cercaId), eq(schema.pontoCerca.filialId, corpo.filialId)))
        .returning({ id: schema.pontoCerca.id });
      if (!r.length) return NextResponse.json({ error: 'cerca não encontrada' }, { status: 404 });
      return NextResponse.json({ ok: true, id: r[0].id });
    }
    const [nova] = await db
      .insert(schema.pontoCerca)
      .values({ ...valores, filialId: corpo.filialId, criadoPor: user.id })
      .returning({ id: schema.pontoCerca.id });
    return NextResponse.json({ ok: true, id: nova.id });
  }

  if ('cercaId' in corpo) {
    const [c] = await db
      .select({ filialId: schema.pontoCerca.filialId })
      .from(schema.pontoCerca)
      .where(eq(schema.pontoCerca.id, corpo.cercaId));
    if (!c) return NextResponse.json({ error: 'cerca não encontrada' }, { status: 404 });
    if (!minhas.has(c.filialId)) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
    await db
      .update(schema.pontoCerca)
      .set({ ativa: false, atualizadoEm: new Date() })
      .where(eq(schema.pontoCerca.id, corpo.cercaId));
    return NextResponse.json({ ok: true });
  }

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
