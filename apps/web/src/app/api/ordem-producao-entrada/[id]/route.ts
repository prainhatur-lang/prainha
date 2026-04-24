// PATCH/DELETE /api/ordem-producao-entrada/[id]
// Edita ou remove linha de entrada. Só permitido em OPs RASCUNHO.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  quantidade: z.number().positive().optional(),
  precoUnitario: z.number().min(0).optional(),
});

async function carregarLinha(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 as const, error: 'id invalido' };
  const [linha] = await db
    .select({
      id: schema.ordemProducaoEntrada.id,
      ordemProducaoId: schema.ordemProducaoEntrada.ordemProducaoId,
      opStatus: schema.ordemProducao.status,
      opFilialId: schema.ordemProducao.filialId,
    })
    .from(schema.ordemProducaoEntrada)
    .innerJoin(
      schema.ordemProducao,
      eq(schema.ordemProducao.id, schema.ordemProducaoEntrada.ordemProducaoId),
    )
    .where(eq(schema.ordemProducaoEntrada.id, id))
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

  const [atual] = await db
    .select({
      quantidade: schema.ordemProducaoEntrada.quantidade,
      precoUnitario: schema.ordemProducaoEntrada.precoUnitario,
    })
    .from(schema.ordemProducaoEntrada)
    .where(eq(schema.ordemProducaoEntrada.id, id))
    .limit(1);
  if (!atual) return NextResponse.json({ error: 'linha nao encontrada' }, { status: 404 });

  const qtd = parsed.data.quantidade ?? Number(atual.quantidade ?? 0);
  const preco =
    parsed.data.precoUnitario !== undefined
      ? parsed.data.precoUnitario
      : Number(atual.precoUnitario ?? 0);
  const valor = qtd * preco;

  const set: Record<string, unknown> = { valorTotal: valor.toFixed(2) };
  if (parsed.data.quantidade !== undefined) set.quantidade = parsed.data.quantidade.toFixed(4);
  if (parsed.data.precoUnitario !== undefined) set.precoUnitario = parsed.data.precoUnitario.toFixed(6);

  await db
    .update(schema.ordemProducaoEntrada)
    .set(set)
    .where(eq(schema.ordemProducaoEntrada.id, id));
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

  await db.delete(schema.ordemProducaoEntrada).where(eq(schema.ordemProducaoEntrada.id, id));
  return NextResponse.json({ id, ok: true });
}
