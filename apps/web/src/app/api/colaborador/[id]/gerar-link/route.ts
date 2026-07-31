// POST /api/colaborador/[id]/gerar-link
// Gera (ou recupera) tokenAcesso permanente do colaborador. Idempotente.
// O token dá acesso ao painel /cozinheiro/[token] com todas as OPs do colab.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [colab] = await db
    .select()
    .from(schema.colaborador)
    .where(eq(schema.colaborador.id, id))
    .limit(1);
  if (!colab) return NextResponse.json({ error: 'colaborador nao encontrado' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, colab.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  let token = colab.tokenAcesso;
  if (!token) {
    token = randomBytes(32).toString('base64url');
    await db
      .update(schema.colaborador)
      .set({ tokenAcesso: token })
      .where(eq(schema.colaborador.id, id));
  }

  return NextResponse.json({ token, nome: colab.nome });
}
