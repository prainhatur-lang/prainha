// POST /api/produto-fornecedor
// Cria mapeamento produto×fornecedor (código do fornecedor, EAN, fator conversão).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  produtoId: z.string().uuid(),
  fornecedorId: z.string().uuid(),
  codigoFornecedor: z.string().max(60).optional().nullable(),
  ean: z.string().max(20).optional().nullable(),
  descricaoFornecedor: z.string().max(500).optional().nullable(),
  unidadeFornecedor: z.string().max(10).optional().nullable(),
  fatorConversao: z.number().positive(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const {
    produtoId,
    fornecedorId,
    codigoFornecedor,
    ean,
    descricaoFornecedor,
    unidadeFornecedor,
    fatorConversao,
  } = parsed.data;

  const [prod] = await db
    .select({ id: schema.produto.id, filialId: schema.produto.filialId })
    .from(schema.produto)
    .where(eq(schema.produto.id, produtoId))
    .limit(1);
  if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });

  const [forn] = await db
    .select({ id: schema.fornecedor.id, filialId: schema.fornecedor.filialId })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, fornecedorId))
    .limit(1);
  if (!forn) return NextResponse.json({ error: 'fornecedor nao encontrado' }, { status: 404 });
  if (forn.filialId !== prod.filialId) {
    return NextResponse.json(
      { error: 'produto e fornecedor em filiais diferentes' },
      { status: 400 },
    );
  }

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, prod.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  try {
    const [created] = await db
      .insert(schema.produtoFornecedor)
      .values({
        filialId: prod.filialId,
        produtoId,
        fornecedorId,
        codigoFornecedor: codigoFornecedor || null,
        ean: ean || null,
        descricaoFornecedor: descricaoFornecedor || null,
        unidadeFornecedor: unidadeFornecedor || null,
        fatorConversao: fatorConversao.toFixed(6),
      })
      .returning({ id: schema.produtoFornecedor.id });
    return NextResponse.json({ id: created?.id }, { status: 201 });
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
}
