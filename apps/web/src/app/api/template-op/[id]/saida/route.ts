// POST /api/template-op/[id]/saida — adiciona linha de saída no template

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  tipo: z.enum(['PRODUTO', 'PERDA']),
  produtoId: z.string().uuid().nullable().optional(),
  quantidadePadrao: z.number().positive(),
  pesoRelativo: z.number().positive().max(100).optional(),
  observacao: z.string().max(500).nullable().optional(),
});

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

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.tipo === 'PRODUTO' && !parsed.data.produtoId) {
    return NextResponse.json(
      { error: 'PRODUTO precisa de produtoId' },
      { status: 400 },
    );
  }

  const [tpl] = await db
    .select({ filialId: schema.templateOp.filialId })
    .from(schema.templateOp)
    .where(eq(schema.templateOp.id, id))
    .limit(1);
  if (!tpl) return NextResponse.json({ error: 'template nao encontrado' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, tpl.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const [created] = await db
    .insert(schema.templateOpSaida)
    .values({
      templateId: id,
      tipo: parsed.data.tipo,
      produtoId: parsed.data.produtoId ?? null,
      quantidadePadrao: parsed.data.quantidadePadrao.toFixed(4),
      pesoRelativo: (parsed.data.pesoRelativo ?? 1).toFixed(4),
      observacao: parsed.data.observacao ?? null,
    })
    .returning({ id: schema.templateOpSaida.id });

  return NextResponse.json({ id: created?.id }, { status: 201 });
}
