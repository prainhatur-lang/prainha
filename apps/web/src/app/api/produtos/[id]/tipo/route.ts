// PATCH /api/produtos/[id]/tipo
// Muda o tipo do produto entre INSUMO e VENDA_SIMPLES.
// Só esses 2 valores são permitidos via UI — VENDA_COMPOSTO/COMBO/etc requerem
// configuracao mais complexa (ficha tecnica) e devem ser ajustados via outra UI.
//
// Body: { tipo: 'INSUMO' | 'VENDA_SIMPLES' }

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

const TIPOS_PERMITIDOS = ['INSUMO', 'VENDA_SIMPLES'] as const;
type TipoPermitido = (typeof TIPOS_PERMITIDOS)[number];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;

  let body: { tipo?: string };
  try {
    body = (await req.json()) as { tipo?: string };
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }

  const tipo = body.tipo as TipoPermitido | undefined;
  if (!tipo || !TIPOS_PERMITIDOS.includes(tipo)) {
    return NextResponse.json(
      { error: `tipo deve ser ${TIPOS_PERMITIDOS.join(' ou ')}` },
      { status: 400 },
    );
  }

  const result = await db
    .update(schema.produto)
    .set({ tipo })
    .where(eq(schema.produto.id, id))
    .returning({ id: schema.produto.id, tipo: schema.produto.tipo });

  if (result.length === 0) {
    return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, tipo: result[0].tipo });
}
