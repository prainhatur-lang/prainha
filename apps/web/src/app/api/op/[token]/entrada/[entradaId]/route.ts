// PATCH/DELETE /api/op/[token]/entrada/[entradaId] — cozinheiro edita ou
// remove uma entrada via link publico (sem auth).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function carregar(token: string, entradaId: string) {
  if (!token || token.length < 20) return { status: 400 as const, error: 'token invalido' };
  if (!/^[0-9a-f-]{36}$/i.test(entradaId)) {
    return { status: 400 as const, error: 'entradaId invalido' };
  }
  const [linha] = await db
    .select({
      id: schema.ordemProducaoEntrada.id,
      produtoId: schema.ordemProducaoEntrada.produtoId,
      opId: schema.ordemProducao.id,
      opStatus: schema.ordemProducao.status,
      precoCusto: schema.produto.precoCusto,
    })
    .from(schema.ordemProducaoEntrada)
    .innerJoin(
      schema.ordemProducao,
      eq(schema.ordemProducao.id, schema.ordemProducaoEntrada.ordemProducaoId),
    )
    .innerJoin(
      schema.produto,
      eq(schema.produto.id, schema.ordemProducaoEntrada.produtoId),
    )
    .where(
      and(
        eq(schema.ordemProducao.tokenPublico, token),
        eq(schema.ordemProducaoEntrada.id, entradaId),
      ),
    )
    .limit(1);
  if (!linha) return { status: 404 as const, error: 'entrada nao encontrada' };
  if (linha.opStatus !== 'RASCUNHO') {
    return { status: 400 as const, error: `OP ${linha.opStatus} nao aceita edicao` };
  }
  return { status: 200 as const, linha };
}

const Body = z
  .object({
    quantidade: z.number().positive().optional(),
    pesoTotalKg: z.number().positive().nullable().optional(),
  })
  .refine(
    (d) => d.quantidade !== undefined || d.pesoTotalKg !== undefined,
    { message: 'informe quantidade ou pesoTotalKg' },
  );

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ token: string; entradaId: string }> },
) {
  const { token, entradaId } = await params;
  const check = await carregar(token, entradaId);
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
  if (parsed.data.quantidade !== undefined) {
    const precoUnit = Number(check.linha.precoCusto ?? 0);
    const valorTotal = precoUnit * parsed.data.quantidade;
    set.quantidade = parsed.data.quantidade.toFixed(4);
    set.precoUnitario = precoUnit > 0 ? precoUnit.toFixed(6) : null;
    set.valorTotal = precoUnit > 0 ? valorTotal.toFixed(2) : null;
  }
  if (parsed.data.pesoTotalKg !== undefined) {
    set.pesoTotalKg =
      parsed.data.pesoTotalKg !== null ? parsed.data.pesoTotalKg.toFixed(3) : null;
  }

  await db
    .update(schema.ordemProducaoEntrada)
    .set(set)
    .where(eq(schema.ordemProducaoEntrada.id, entradaId));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ token: string; entradaId: string }> },
) {
  const { token, entradaId } = await params;
  const check = await carregar(token, entradaId);
  if (check.status !== 200) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  await db
    .delete(schema.ordemProducaoEntrada)
    .where(eq(schema.ordemProducaoEntrada.id, entradaId));
  return NextResponse.json({ ok: true });
}
