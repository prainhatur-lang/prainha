// POST /api/op/[token]/saida — adiciona saída via link público (sem auth)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  tipo: z.enum(['PRODUTO', 'PERDA']),
  produtoId: z.string().uuid().nullable().optional(),
  quantidade: z.number().positive(),
  pesoRelativo: z.number().positive().max(100).optional(),
  observacao: z.string().max(500).nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token invalido' }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (parsed.data.tipo === 'PRODUTO' && !parsed.data.produtoId) {
    return NextResponse.json(
      { error: 'PRODUTO precisa de produtoId' },
      { status: 400 },
    );
  }

  const [op] = await db
    .select({
      id: schema.ordemProducao.id,
      filialId: schema.ordemProducao.filialId,
      status: schema.ordemProducao.status,
    })
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.tokenPublico, token))
    .limit(1);
  if (!op) return NextResponse.json({ error: 'OP nao encontrada' }, { status: 404 });
  if (op.status !== 'RASCUNHO') {
    return NextResponse.json(
      { error: `OP ${op.status} — nao aceita mais edicao` },
      { status: 400 },
    );
  }

  // Valida que o produto pertence à mesma filial
  if (parsed.data.produtoId) {
    const [prod] = await db
      .select({ filialId: schema.produto.filialId })
      .from(schema.produto)
      .where(eq(schema.produto.id, parsed.data.produtoId))
      .limit(1);
    if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });
    if (prod.filialId !== op.filialId) {
      return NextResponse.json({ error: 'produto em filial diferente' }, { status: 400 });
    }
  }

  const [created] = await db
    .insert(schema.ordemProducaoSaida)
    .values({
      ordemProducaoId: op.id,
      tipo: parsed.data.tipo,
      produtoId: parsed.data.produtoId ?? null,
      quantidade: parsed.data.quantidade.toFixed(4),
      pesoRelativo: (parsed.data.pesoRelativo ?? 1).toFixed(4),
      observacao: parsed.data.observacao ?? null,
    })
    .returning({ id: schema.ordemProducaoSaida.id });

  return NextResponse.json({ id: created?.id }, { status: 201 });
}
