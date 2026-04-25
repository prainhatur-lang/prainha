// PATCH/DELETE /api/op/[token]/saida/[saidaId] — edita/remove saída via link público

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function carregar(token: string, saidaId: string) {
  if (!token || token.length < 20) return { status: 400 as const, error: 'token invalido' };
  if (!/^[0-9a-f-]{36}$/i.test(saidaId)) {
    return { status: 400 as const, error: 'saidaId invalido' };
  }
  const [linha] = await db
    .select({
      id: schema.ordemProducaoSaida.id,
      opId: schema.ordemProducao.id,
      opStatus: schema.ordemProducao.status,
    })
    .from(schema.ordemProducaoSaida)
    .innerJoin(
      schema.ordemProducao,
      eq(schema.ordemProducao.id, schema.ordemProducaoSaida.ordemProducaoId),
    )
    .where(
      and(
        eq(schema.ordemProducao.tokenPublico, token),
        eq(schema.ordemProducaoSaida.id, saidaId),
      ),
    )
    .limit(1);
  if (!linha) return { status: 404 as const, error: 'saida nao encontrada' };
  if (linha.opStatus !== 'RASCUNHO') {
    return { status: 400 as const, error: `OP ${linha.opStatus} nao aceita edicao` };
  }
  return { status: 200 as const };
}

const Body = z.object({
  tipo: z.enum(['PRODUTO', 'PERDA']).optional(),
  produtoId: z.string().uuid().nullable().optional(),
  quantidade: z.number().positive().optional(),
  pesoRelativo: z.number().positive().max(100).optional(),
  observacao: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ token: string; saidaId: string }> },
) {
  const { token, saidaId } = await params;
  const check = await carregar(token, saidaId);
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
  if (parsed.data.tipo !== undefined) set.tipo = parsed.data.tipo;
  if (parsed.data.produtoId !== undefined) set.produtoId = parsed.data.produtoId;
  if (parsed.data.quantidade !== undefined)
    set.quantidade = parsed.data.quantidade.toFixed(4);
  if (parsed.data.pesoRelativo !== undefined)
    set.pesoRelativo = parsed.data.pesoRelativo.toFixed(4);
  if (parsed.data.observacao !== undefined) set.observacao = parsed.data.observacao;

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await db
    .update(schema.ordemProducaoSaida)
    .set(set)
    .where(eq(schema.ordemProducaoSaida.id, saidaId));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ token: string; saidaId: string }> },
) {
  const { token, saidaId } = await params;
  const check = await carregar(token, saidaId);
  if (check.status !== 200) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  await db
    .delete(schema.ordemProducaoSaida)
    .where(eq(schema.ordemProducaoSaida.id, saidaId));
  return NextResponse.json({ ok: true });
}
