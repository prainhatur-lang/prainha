// PATCH /api/fornecedores/[id]
// Atualiza campos editaveis do fornecedor.
// Body: { valorPedidoMinimo?, ativoCompras?, categoriaCompras? }

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const _semPerm = await negarSemPerm(user.id, 'fornecedor.update');
  if (_semPerm) return _semPerm;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  let body: {
    valorPedidoMinimo?: number | string | null;
    ativoCompras?: boolean;
    categoriaCompras?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }

  const updates: Partial<typeof schema.fornecedor.$inferInsert> = {};
  if ('valorPedidoMinimo' in body) {
    if (body.valorPedidoMinimo == null || body.valorPedidoMinimo === '') {
      updates.valorPedidoMinimo = null;
    } else {
      const v = Number(String(body.valorPedidoMinimo).replace(',', '.'));
      if (!Number.isFinite(v) || v < 0) {
        return NextResponse.json({ error: 'valorPedidoMinimo invalido' }, { status: 400 });
      }
      updates.valorPedidoMinimo = v.toFixed(2);
    }
  }
  if (typeof body.ativoCompras === 'boolean') updates.ativoCompras = body.ativoCompras;
  if ('categoriaCompras' in body) updates.categoriaCompras = body.categoriaCompras ?? null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nenhum campo pra atualizar' }, { status: 400 });
  }

  const result = await db
    .update(schema.fornecedor)
    .set(updates)
    .where(eq(schema.fornecedor.id, id))
    .returning({
      id: schema.fornecedor.id,
      valorPedidoMinimo: schema.fornecedor.valorPedidoMinimo,
      ativoCompras: schema.fornecedor.ativoCompras,
      categoriaCompras: schema.fornecedor.categoriaCompras,
    });

  if (result.length === 0) {
    return NextResponse.json({ error: 'fornecedor nao encontrado' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, fornecedor: result[0] });
}
