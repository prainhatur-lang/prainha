// PATCH /api/avaliacoes/[id] — atualiza status / observacao de uma avaliacao.
// Workflow das avaliacoes baixas: novo -> em_contato -> resolvido.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS_OK = new Set(['novo', 'em_contato', 'resolvido']);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await exigirPermApi('avaliacao.update');
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const status = typeof body?.status === 'string' ? body.status : undefined;
  if (status && !STATUS_OK.has(status)) {
    return NextResponse.json({ error: 'status inválido' }, { status: 400 });
  }
  const observacao =
    typeof body?.observacaoInterna === 'string'
      ? body.observacaoInterna.slice(0, 2000)
      : undefined;
  if (status === undefined && observacao === undefined) {
    return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 });
  }

  // So permite mexer em avaliacoes de filiais que o usuario enxerga.
  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (filialIds.length === 0) {
    return NextResponse.json({ error: 'sem filiais' }, { status: 403 });
  }

  const set: Record<string, unknown> = { atualizadoEm: sql`now()` };
  if (status !== undefined) {
    set.status = status;
    set.resolvidoPor = status === 'resolvido' ? user.id : null;
  }
  if (observacao !== undefined) set.observacaoInterna = observacao || null;

  const upd = await db
    .update(schema.avaliacao)
    .set(set)
    .where(and(eq(schema.avaliacao.id, id), inArray(schema.avaliacao.filialId, filialIds)))
    .returning({ id: schema.avaliacao.id });

  if (upd.length === 0) {
    return NextResponse.json({ error: 'avaliação não encontrada' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
