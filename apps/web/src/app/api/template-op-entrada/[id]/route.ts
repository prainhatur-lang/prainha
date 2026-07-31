// PATCH/DELETE /api/template-op-entrada/[id]

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function carregar(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 as const, error: 'id invalido' };
  const [linha] = await db
    .select({
      id: schema.templateOpEntrada.id,
      filialId: schema.templateOp.filialId,
    })
    .from(schema.templateOpEntrada)
    .innerJoin(
      schema.templateOp,
      eq(schema.templateOp.id, schema.templateOpEntrada.templateId),
    )
    .where(eq(schema.templateOpEntrada.id, id))
    .limit(1);
  if (!linha) return { status: 404 as const, error: 'linha nao encontrada' };
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        eq(schema.usuarioFilial.filialId, linha.filialId),
      ),
    )
    .limit(1);
  if (!link) return { status: 403 as const, error: 'sem acesso' };
  return { status: 200 as const };
}

const Body = z.object({
  produtoId: z.string().uuid().optional(),
  quantidadePadrao: z.number().positive().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const check = await carregar(id, user.id);
  if (check.status !== 200) {
    return NextResponse.json({ error: check.error }, { status: check.status });
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
  if (parsed.data.produtoId !== undefined) set.produtoId = parsed.data.produtoId;
  if (parsed.data.quantidadePadrao !== undefined)
    set.quantidadePadrao = parsed.data.quantidadePadrao.toFixed(4);

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await db
    .update(schema.templateOpEntrada)
    .set(set)
    .where(eq(schema.templateOpEntrada.id, id));
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
  const check = await carregar(id, user.id);
  if (check.status !== 200) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  await db.delete(schema.templateOpEntrada).where(eq(schema.templateOpEntrada.id, id));
  return NextResponse.json({ id, ok: true });
}
