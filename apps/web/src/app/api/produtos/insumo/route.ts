// POST /api/produtos/insumo
// Cria um produto do tipo INSUMO direto na nuvem (sem vir do Consumer).
// Usado no botão "Novo insumo" em /cadastros/produtos.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UNIDADES = ['un', 'ml', 'g', 'kg', 'l'] as const;

const Body = z.object({
  filialId: z.string().uuid(),
  nome: z.string().min(1).max(200).trim(),
  unidadeEstoque: z.enum(UNIDADES),
  estoqueMinimo: z.number().min(0).optional(),
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

  const { filialId, nome, unidadeEstoque, estoqueMinimo } = parsed.data;

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const [created] = await db
    .insert(schema.produto)
    .values({
      filialId,
      nome,
      tipo: 'INSUMO',
      unidadeEstoque,
      controlaEstoque: true,
      criadoNaNuvem: true,
      estoqueControlado: true,
      estoqueMinimo: estoqueMinimo !== undefined ? estoqueMinimo.toFixed(3) : null,
      codigoExterno: null,
    })
    .returning({ id: schema.produto.id });

  return NextResponse.json({ id: created?.id }, { status: 201 });
}
