// POST /api/ordem-producao/[id]/saida
// Adiciona uma linha de saída (produto gerado ou perda) na OP em RASCUNHO.
// Tipo: PRODUTO (gera estoque quando concluir) | PERDA.
// PRODUTO exige produtoId. PERDA pode ter produtoId null (perda genérica).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  tipo: z.enum(['PRODUTO', 'PERDA']),
  produtoId: z.string().uuid().nullable().optional(),
  quantidade: z.number().positive(),
  /** Peso relativo no rateio (default 1). Maior = corte mais nobre,
   *  absorve mais custo. Só faz efeito em saídas tipo PRODUTO. */
  pesoRelativo: z.number().positive().max(100).optional(),
  observacao: z.string().max(500).nullable().optional(),
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

  if (parsed.data.tipo === 'PRODUTO' && !parsed.data.produtoId) {
    return NextResponse.json(
      { error: 'saida do tipo PRODUTO precisa de produtoId' },
      { status: 400 },
    );
  }

  if (parsed.data.produtoId) {
    const [prod] = await db
      .select({ id: schema.produto.id, filialId: schema.produto.filialId })
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
      ordemProducaoId: id,
      tipo: parsed.data.tipo,
      produtoId: parsed.data.produtoId ?? null,
      quantidade: parsed.data.quantidade.toFixed(4),
      pesoRelativo: (parsed.data.pesoRelativo ?? 1).toFixed(4),
      observacao: parsed.data.observacao ?? null,
    })
    .returning({ id: schema.ordemProducaoSaida.id });

  return NextResponse.json({ id: created?.id }, { status: 201 });
}
