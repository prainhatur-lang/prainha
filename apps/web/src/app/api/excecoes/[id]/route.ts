// PATCH /api/excecoes/[id]
// Body: { observacao?: string }
// Marca excecao como aceita/resolvida (aceita_em = now).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  observacao: z.string().max(500).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido' }, { status: 400 });
  }

  // RBAC: verifica que a excecao pertence a uma filial do usuario
  const [exc] = await db
    .select({ id: schema.excecao.id, filialId: schema.excecao.filialId })
    .from(schema.excecao)
    .where(eq(schema.excecao.id, id))
    .limit(1);
  if (!exc) return NextResponse.json({ error: 'nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, exc.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const [updated] = await db
    .update(schema.excecao)
    .set({
      aceitaEm: new Date(),
      aceitaPor: user.id,
      observacao: parsed.data.observacao ?? null,
    })
    .where(eq(schema.excecao.id, id))
    .returning({ id: schema.excecao.id, aceitaEm: schema.excecao.aceitaEm });

  return NextResponse.json(updated);
}
