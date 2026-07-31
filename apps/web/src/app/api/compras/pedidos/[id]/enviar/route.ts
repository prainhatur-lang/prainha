// POST /api/compras/pedidos/[id]/enviar
// Marca o pedido de compra como ENVIADO (enviado_em = now). Usado pelo botão
// "📲 Enviar pedido" que abre o WhatsApp com o resumo pro fornecedor.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'pedido_compra.enviar');
  if (semPerm) return semPerm;

  const { id } = await params;
  const r = await db
    .update(schema.pedidoCompra)
    .set({ status: 'ENVIADO', enviadoEm: sql`now()` })
    .where(and(eq(schema.pedidoCompra.id, id), sql`${schema.pedidoCompra.status} <> 'CANCELADO'`))
    .returning({ id: schema.pedidoCompra.id });

  if (r.length === 0) return NextResponse.json({ error: 'pedido nao encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
