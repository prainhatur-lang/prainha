// DELETE /api/produtos/[id]/marcas/[vinculoId]
// Remove o vinculo produto x marca aceita. A marca em si fica preservada
// (pode estar sendo usada por outros produtos).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; vinculoId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: produtoId, vinculoId } = await params;

  const result = await db
    .delete(schema.produtoMarcaAceita)
    .where(
      and(
        eq(schema.produtoMarcaAceita.id, vinculoId),
        eq(schema.produtoMarcaAceita.produtoId, produtoId),
      ),
    )
    .returning({ id: schema.produtoMarcaAceita.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'vinculo nao encontrado' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
