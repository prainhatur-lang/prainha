// POST /api/cotacao/[id]/excluir-item
// Gestor tira (ou devolve) UM item da cotação de UM fornecedor específico.
// Item excluído some do link do fornecedor e a resposta dele não disputa.
//
// Body: { cotacaoFornecedorId, cotacaoItemId, excluir: boolean }

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { definirExclusaoItem } from '@/lib/cotacao-exclusao';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: cotacaoId } = await params;

  let body: { cotacaoFornecedorId?: string; cotacaoItemId?: string; excluir?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const { cotacaoFornecedorId, cotacaoItemId } = body;
  if (!cotacaoFornecedorId || !cotacaoItemId) {
    return NextResponse.json({ error: 'cotacaoFornecedorId e cotacaoItemId obrigatorios' }, { status: 400 });
  }

  // Confere que a convocação e o item pertencem a esta cotação
  const [cf] = await db
    .select({ id: schema.cotacaoFornecedor.id })
    .from(schema.cotacaoFornecedor)
    .where(
      and(
        eq(schema.cotacaoFornecedor.id, cotacaoFornecedorId),
        eq(schema.cotacaoFornecedor.cotacaoId, cotacaoId),
      ),
    )
    .limit(1);
  const [item] = await db
    .select({ id: schema.cotacaoItem.id })
    .from(schema.cotacaoItem)
    .where(
      and(eq(schema.cotacaoItem.id, cotacaoItemId), eq(schema.cotacaoItem.cotacaoId, cotacaoId)),
    )
    .limit(1);
  if (!cf || !item) {
    return NextResponse.json({ error: 'fornecedor ou item nao pertence a esta cotacao' }, { status: 404 });
  }

  await definirExclusaoItem(cotacaoFornecedorId, cotacaoItemId, body.excluir !== false);
  return NextResponse.json({ ok: true });
}
