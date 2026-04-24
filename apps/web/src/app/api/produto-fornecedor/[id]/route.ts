// PATCH/DELETE /api/produto-fornecedor/[id]
// Edita ou remove um mapeamento produto×fornecedor.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  codigoFornecedor: z.string().max(60).nullable().optional(),
  ean: z.string().max(20).nullable().optional(),
  descricaoFornecedor: z.string().max(500).nullable().optional(),
  unidadeFornecedor: z.string().max(10).nullable().optional(),
  fatorConversao: z.number().positive().optional(),
});

async function carregarLinha(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 as const, error: 'id invalido' };
  const [linha] = await db
    .select({ id: schema.produtoFornecedor.id, filialId: schema.produtoFornecedor.filialId })
    .from(schema.produtoFornecedor)
    .where(eq(schema.produtoFornecedor.id, id))
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
  return { status: 200 as const, linha };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const check = await carregarLinha(id, user.id);
  if (check.status !== 200) return NextResponse.json({ error: check.error }, { status: check.status });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const set: Record<string, unknown> = { atualizadoEm: new Date() };
  if (d.codigoFornecedor !== undefined) set.codigoFornecedor = d.codigoFornecedor || null;
  if (d.ean !== undefined) set.ean = d.ean || null;
  if (d.descricaoFornecedor !== undefined) set.descricaoFornecedor = d.descricaoFornecedor || null;
  if (d.unidadeFornecedor !== undefined) set.unidadeFornecedor = d.unidadeFornecedor || null;
  if (d.fatorConversao !== undefined) set.fatorConversao = d.fatorConversao.toFixed(6);

  if (Object.keys(set).length === 1) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  try {
    await db.update(schema.produtoFornecedor).set(set).where(eq(schema.produtoFornecedor.id, id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('uq_prod_forn_codigo')) {
      return NextResponse.json(
        { error: 'esse codigo ja esta mapeado nesse fornecedor pra outro produto' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
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
  const check = await carregarLinha(id, user.id);
  if (check.status !== 200) return NextResponse.json({ error: check.error }, { status: check.status });

  await db.delete(schema.produtoFornecedor).where(eq(schema.produtoFornecedor.id, id));
  return NextResponse.json({ id, ok: true });
}
