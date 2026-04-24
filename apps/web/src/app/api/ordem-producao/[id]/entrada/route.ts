// POST /api/ordem-producao/[id]/entrada
// Adiciona uma linha de entrada (insumo consumido) na OP em RASCUNHO.
// Se precoUnitario não vier, tenta pegar do produto.precoCusto.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive(),
  precoUnitario: z.number().min(0).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
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
    .where(eq(schema.ordemProducao.id, id))
    .limit(1);
  if (!op) return NextResponse.json({ error: 'OP nao encontrada' }, { status: 404 });
  if (op.status !== 'RASCUNHO') {
    return NextResponse.json({ error: `OP ${op.status} nao aceita edicao` }, { status: 400 });
  }

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, op.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const [prod] = await db
    .select({
      id: schema.produto.id,
      filialId: schema.produto.filialId,
      precoCusto: schema.produto.precoCusto,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, parsed.data.produtoId))
    .limit(1);
  if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });
  if (prod.filialId !== op.filialId) {
    return NextResponse.json({ error: 'produto em filial diferente' }, { status: 400 });
  }

  const preco =
    parsed.data.precoUnitario !== undefined
      ? parsed.data.precoUnitario
      : prod.precoCusto
        ? Number(prod.precoCusto)
        : 0;
  const valor = parsed.data.quantidade * preco;

  const [created] = await db
    .insert(schema.ordemProducaoEntrada)
    .values({
      ordemProducaoId: id,
      produtoId: prod.id,
      quantidade: parsed.data.quantidade.toFixed(4),
      precoUnitario: preco.toFixed(6),
      valorTotal: valor.toFixed(2),
    })
    .returning({ id: schema.ordemProducaoEntrada.id });

  return NextResponse.json({ id: created?.id }, { status: 201 });
}
