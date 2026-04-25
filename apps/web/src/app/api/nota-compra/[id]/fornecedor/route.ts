// PATCH /api/nota-compra/[id]/fornecedor — vincula um fornecedor a uma nota.
// Usado quando o upload nao achou fornecedor por CNPJ (ex: fornecedor novo
// que nao foi sincronizado do Consumer ainda) e o user precisa criar/escolher
// um manualmente antes de gerar contas a pagar.
// Body: { fornecedorId: uuid }

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  fornecedorId: z.string().uuid(),
});

export async function PATCH(
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

  const [nota] = await db
    .select({ id: schema.notaCompra.id, filialId: schema.notaCompra.filialId })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Garante que o fornecedor pertence a mesma filial
  const [forn] = await db
    .select({ id: schema.fornecedor.id, filialId: schema.fornecedor.filialId })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, parsed.data.fornecedorId))
    .limit(1);
  if (!forn) return NextResponse.json({ error: 'fornecedor nao encontrado' }, { status: 404 });
  if (forn.filialId !== nota.filialId) {
    return NextResponse.json({ error: 'fornecedor de filial diferente' }, { status: 400 });
  }

  await db
    .update(schema.notaCompra)
    .set({ fornecedorId: parsed.data.fornecedorId })
    .where(eq(schema.notaCompra.id, id));

  return NextResponse.json({ ok: true });
}
