// POST /api/fornecedores/condicao-pagamento — { fornecedorId, condicao }
// Salva a condição de pagamento do fornecedor (editável na tela do pedido).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { salvarCondicaoPagamento } from '@/lib/fornecedor-condicao';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { fornecedorId?: string; condicao?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  if (!body.fornecedorId) {
    return NextResponse.json({ error: 'fornecedorId obrigatorio' }, { status: 400 });
  }

  const [f] = await db
    .select({ id: schema.fornecedor.id })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, body.fornecedorId))
    .limit(1);
  if (!f) return NextResponse.json({ error: 'fornecedor nao encontrado' }, { status: 404 });

  await salvarCondicaoPagamento(body.fornecedorId, body.condicao?.trim().slice(0, 120) || null);
  return NextResponse.json({ ok: true });
}
