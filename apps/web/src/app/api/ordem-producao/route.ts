// POST /api/ordem-producao
// Cria uma nova ordem de produção (status RASCUNHO).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  filialId: z.string().uuid(),
  descricao: z.string().max(200).optional(),
  observacao: z.string().max(1000).optional(),
  dataHora: z.string().datetime().optional(),
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

  const { filialId, descricao, observacao, dataHora } = parsed.data;

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
    .insert(schema.ordemProducao)
    .values({
      filialId,
      descricao: descricao ?? null,
      observacao: observacao ?? null,
      dataHora: dataHora ? new Date(dataHora) : new Date(),
      status: 'RASCUNHO',
      criadoPor: user.id,
    })
    .returning({ id: schema.ordemProducao.id });

  return NextResponse.json({ id: created?.id }, { status: 201 });
}
