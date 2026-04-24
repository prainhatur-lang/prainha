// PATCH/DELETE /api/ordem-producao/[id]
// Atualiza header (descricao, observacao, dataHora) ou deleta OP em RASCUNHO.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  descricao: z.string().max(200).nullable().optional(),
  observacao: z.string().max(1000).nullable().optional(),
  dataHora: z.string().datetime().optional(),
});

async function carregarOp(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 as const, error: 'id invalido' };
  const [op] = await db
    .select({
      id: schema.ordemProducao.id,
      filialId: schema.ordemProducao.filialId,
      status: schema.ordemProducao.status,
    })
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.id, id))
    .limit(1);
  if (!op) return { status: 404 as const, error: 'OP nao encontrada' };
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        eq(schema.usuarioFilial.filialId, op.filialId),
      ),
    )
    .limit(1);
  if (!link) return { status: 403 as const, error: 'sem acesso' };
  return { status: 200 as const, op };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const check = await carregarOp(id, user.id);
  if (check.status !== 200) return NextResponse.json({ error: check.error }, { status: check.status });

  if (check.op.status !== 'RASCUNHO') {
    return NextResponse.json(
      { error: `OP ${check.op.status} nao pode ser editada` },
      { status: 400 },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const set: Record<string, unknown> = {};
  if (parsed.data.descricao !== undefined) set.descricao = parsed.data.descricao;
  if (parsed.data.observacao !== undefined) set.observacao = parsed.data.observacao;
  if (parsed.data.dataHora !== undefined) set.dataHora = new Date(parsed.data.dataHora);

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await db.update(schema.ordemProducao).set(set).where(eq(schema.ordemProducao.id, id));
  return NextResponse.json({ id, ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const check = await carregarOp(id, user.id);
  if (check.status !== 200) return NextResponse.json({ error: check.error }, { status: check.status });

  if (check.op.status !== 'RASCUNHO') {
    return NextResponse.json(
      { error: `OP ${check.op.status} nao pode ser deletada — use cancelar` },
      { status: 400 },
    );
  }

  await db.delete(schema.ordemProducao).where(eq(schema.ordemProducao.id, id));
  return NextResponse.json({ id, ok: true });
}
