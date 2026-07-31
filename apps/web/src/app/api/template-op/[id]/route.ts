// PATCH /api/template-op/[id] — edita header
// DELETE /api/template-op/[id] — soft delete (ativo=false)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function carregar(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 as const, error: 'id invalido' };
  const [tpl] = await db
    .select()
    .from(schema.templateOp)
    .where(eq(schema.templateOp.id, id))
    .limit(1);
  if (!tpl) return { status: 404 as const, error: 'template nao encontrado' };
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        eq(schema.usuarioFilial.filialId, tpl.filialId),
      ),
    )
    .limit(1);
  if (!link) return { status: 403 as const, error: 'sem acesso' };
  return { status: 200 as const, tpl };
}

const Body = z.object({
  nome: z.string().min(1).max(200).optional(),
  descricaoPadrao: z.string().max(200).nullable().optional(),
  observacao: z.string().max(1000).nullable().optional(),
  ativo: z.boolean().optional(),
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

  const set: Record<string, unknown> = { atualizadoEm: new Date() };
  if (parsed.data.nome !== undefined) set.nome = parsed.data.nome.trim();
  if (parsed.data.descricaoPadrao !== undefined)
    set.descricaoPadrao = parsed.data.descricaoPadrao;
  if (parsed.data.observacao !== undefined) set.observacao = parsed.data.observacao;
  if (parsed.data.ativo !== undefined) set.ativo = parsed.data.ativo;

  await db.update(schema.templateOp).set(set).where(eq(schema.templateOp.id, id));
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

  await db
    .update(schema.templateOp)
    .set({ ativo: false, atualizadoEm: new Date() })
    .where(eq(schema.templateOp.id, id));
  return NextResponse.json({ id, ok: true });
}
