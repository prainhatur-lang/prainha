// GET  /api/metas?filialId=... — lista metas da filial (sem progresso ao
//      vivo — é pesado, calculado só no detalhe).
// POST /api/metas — cria meta nova (sempre status='aberta').

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, desc, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { METRICAS } from '@/lib/metas/metricas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function checarAcesso(userId: string, filialId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) return false;
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, userId), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  return !!link;
}

function boundsCompetencia(competencia: string): { dataInicio: string; dataFim: string } {
  const [ano, mes] = competencia.split('-').map(Number);
  const mm = String(mes).padStart(2, '0');
  const lastDay = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { dataInicio: `${ano}-${mm}-01`, dataFim: `${ano}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

export async function GET(req: Request) {
  const { user, error } = await exigirPermApi('meta.read');
  if (error) return error;

  const url = new URL(req.url);
  const filialId = url.searchParams.get('filialId') ?? '';
  if (!(await checarAcesso(user.id, filialId))) {
    return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  }

  const metas = await db
    .select()
    .from(schema.metaEquipe)
    .where(eq(schema.metaEquipe.filialId, filialId))
    .orderBy(desc(schema.metaEquipe.competencia));

  return NextResponse.json({ metas });
}

const PostBody = z.object({
  filialId: z.string().uuid(),
  nome: z.string().min(1).max(200),
  metrica: z.enum(METRICAS),
  valorAlvo: z.string().regex(/^\d+(\.\d{1,2})?$/),
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  premiacaoTotal: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('meta.create');
  if (error) return error;

  const json = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  if (!(await checarAcesso(user.id, d.filialId))) {
    return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  }

  const { dataInicio, dataFim } = boundsCompetencia(d.competencia);

  const [criada] = await db
    .insert(schema.metaEquipe)
    .values({
      filialId: d.filialId,
      nome: d.nome.trim(),
      metrica: d.metrica,
      valorAlvo: d.valorAlvo,
      competencia: d.competencia,
      dataInicio,
      dataFim,
      premiacaoTotal: d.premiacaoTotal,
    })
    .returning();

  return NextResponse.json({ meta: criada }, { status: 201 });
}
