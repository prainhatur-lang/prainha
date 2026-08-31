// GET    /api/metas/[id] — detalhe. Se status='aberta', mede a métrica ao
//        vivo (nada gravado). Se avaliada/vinculada, retorna os valores
//        congelados + o rateio.
// PATCH  /api/metas/[id] — edita nome/valorAlvo/premiacaoTotal. Só se aberta.
// DELETE /api/metas/[id] — aberta: apaga de vez. avaliada: cancela (soft,
//        mantém o rateio pra auditoria). vinculada: bloqueado (reabra antes).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { medirMetrica, type Metrica } from '@/lib/metas/metricas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function carregar(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 as const, error: 'id invalido' };
  const [meta] = await db.select().from(schema.metaEquipe).where(eq(schema.metaEquipe.id, id)).limit(1);
  if (!meta) return { status: 404 as const, error: 'meta nao encontrada' };
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, userId), eq(schema.usuarioFilial.filialId, meta.filialId)))
    .limit(1);
  if (!link) return { status: 403 as const, error: 'sem acesso' };
  return { status: 200 as const, meta };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('meta.read');
  if (error) return error;

  const { id } = await params;
  const check = await carregar(id, user.id);
  if (check.status !== 200) return NextResponse.json({ error: check.error }, { status: check.status });
  const { meta } = check;

  if (meta.status === 'aberta') {
    const [ano, mes] = meta.competencia.split('-').map(Number);
    const valorRealizado = await medirMetrica(meta.filialId, meta.metrica as Metrica, ano, mes);
    return NextResponse.json({
      meta,
      progressoAoVivo: {
        valorRealizado,
        bateuMeta: valorRealizado >= Number(meta.valorAlvo),
        pct: Number(meta.valorAlvo) > 0 ? (valorRealizado / Number(meta.valorAlvo)) * 100 : 0,
      },
      rateio: [],
    });
  }

  const rateio = await db.select().from(schema.metaEquipeRateio).where(eq(schema.metaEquipeRateio.metaEquipeId, id));
  return NextResponse.json({ meta, progressoAoVivo: null, rateio });
}

const PatchBody = z.object({
  nome: z.string().min(1).max(200).optional(),
  valorAlvo: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  premiacaoTotal: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('meta.update');
  if (error) return error;

  const { id } = await params;
  const check = await carregar(id, user.id);
  if (check.status !== 200) return NextResponse.json({ error: check.error }, { status: check.status });
  if (check.meta.status !== 'aberta') {
    return NextResponse.json({ error: 'só dá pra editar meta com status aberta' }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const set: Record<string, unknown> = { atualizadoEm: new Date() };
  if (d.nome !== undefined) set.nome = d.nome.trim();
  if (d.valorAlvo !== undefined) set.valorAlvo = d.valorAlvo;
  if (d.premiacaoTotal !== undefined) set.premiacaoTotal = d.premiacaoTotal;

  if (Object.keys(set).length === 1) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await db.update(schema.metaEquipe).set(set).where(eq(schema.metaEquipe.id, id));
  return NextResponse.json({ id, ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('meta.delete');
  if (error) return error;

  const { id } = await params;
  const check = await carregar(id, user.id);
  if (check.status !== 200) return NextResponse.json({ error: check.error }, { status: check.status });
  const { meta } = check;

  if (meta.status === 'vinculada') {
    return NextResponse.json(
      { error: 'meta já vinculada a uma folha — reabra antes de cancelar' },
      { status: 400 },
    );
  }
  if (meta.status === 'aberta') {
    await db.delete(schema.metaEquipe).where(eq(schema.metaEquipe.id, id));
    return NextResponse.json({ ok: true, deletada: true });
  }
  // 'avaliada' ou 'cancelada': soft-cancel, mantém o rateio pra auditoria.
  await db.update(schema.metaEquipe).set({ status: 'cancelada', atualizadoEm: new Date() }).where(eq(schema.metaEquipe.id, id));
  return NextResponse.json({ ok: true, cancelada: true });
}
