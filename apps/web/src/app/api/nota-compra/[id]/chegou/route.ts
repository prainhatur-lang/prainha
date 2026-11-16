// POST /api/nota-compra/[id]/chegou
// Conferência dos antecipados (dono, 16/11/2026): marca que a compra paga
// antes chegou INTEIRA — grava a conferência da nota com todos os itens na
// quantidade cheia (mesmo registro do "Conferir entrega", com quem e quando).
// Chegou faltando? Aí é pelo "Conferir entrega" na tela da nota, item a item.
// Body: { observacao?: string }

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { gravarConferenciaNota } from '@/lib/nota-conferencia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  const body = (await req.json().catch(() => ({}))) as { observacao?: string | null };

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

  const itens = await db
    .select({ id: schema.notaCompraItem.id, quantidade: schema.notaCompraItem.quantidade })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.notaCompraId, id));

  const obs = (typeof body.observacao === 'string' ? body.observacao.trim() : '') || 'Chegou — marcado na conferência dos antecipados';
  await gravarConferenciaNota(
    id,
    itens.map((i) => ({ itemId: i.id, qtdRecebida: Number(i.quantidade) })),
    obs.slice(0, 500),
    user.id,
  );
  return NextResponse.json({ ok: true });
}
