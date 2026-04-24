// PATCH/DELETE /api/ordem-producao-saida/[id]
// Edita ou remove linha de saída. Só em OPs RASCUNHO.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  quantidade: z.number().positive().optional(),
  tipo: z.enum(['PRODUTO', 'PERDA']).optional(),
  produtoId: z.string().uuid().nullable().optional(),
  observacao: z.string().max(500).nullable().optional(),
});

async function carregarLinha(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 as const, error: 'id invalido' };
  const [linha] = await db
    .select({
      id: schema.ordemProducaoSaida.id,
      opStatus: schema.ordemProducao.status,
      opFilialId: schema.ordemProducao.filialId,
    })
    .from(schema.ordemProducaoSaida)
    .innerJoin(
      schema.ordemProducao,
      eq(schema.ordemProducao.id, schema.ordemProducaoSaida.ordemProducaoId),
    )
    .where(eq(schema.ordemProducaoSaida.id, id))
    .limit(1);
  if (!linha) return { status: 404 as const, error: 'linha nao encontrada' };
  if (linha.opStatus !== 'RASCUNHO') {
    return { status: 400 as const, error: `OP ${linha.opStatus} nao aceita edicao` };
  }
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        eq(schema.usuarioFilial.filialId, linha.opFilialId),
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

  const set: Record<string, unknown> = {};
  if (parsed.data.quantidade !== undefined) set.quantidade = parsed.data.quantidade.toFixed(4);
  if (parsed.data.tipo !== undefined) set.tipo = parsed.data.tipo;
  if (parsed.data.produtoId !== undefined) set.produtoId = parsed.data.produtoId;
  if (parsed.data.observacao !== undefined) set.observacao = parsed.data.observacao;

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  if (set.tipo === 'PRODUTO' && set.produtoId === null) {
    return NextResponse.json(
      { error: 'saida PRODUTO precisa de produtoId' },
      { status: 400 },
    );
  }

  await db.update(schema.ordemProducaoSaida).set(set).where(eq(schema.ordemProducaoSaida.id, id));
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

  await db.delete(schema.ordemProducaoSaida).where(eq(schema.ordemProducaoSaida.id, id));
  return NextResponse.json({ id, ok: true });
}
