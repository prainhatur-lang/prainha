// POST /api/ordem-producao/[id]/cancelar
// Cancela OP em RASCUNHO. Para OPs já CONCLUIDAS não dá pra cancelar
// (teria que reverter movimentos — implementar depois se precisar).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
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

  if (op.status === 'CANCELADA') {
    return NextResponse.json({ error: 'OP ja esta cancelada' }, { status: 400 });
  }
  if (op.status === 'CONCLUIDA') {
    return NextResponse.json(
      { error: 'OP CONCLUIDA nao pode ser cancelada (movimentos ja gerados)' },
      { status: 400 },
    );
  }

  await db
    .update(schema.ordemProducao)
    .set({ status: 'CANCELADA' })
    .where(eq(schema.ordemProducao.id, id));

  return NextResponse.json({ id, ok: true });
}
