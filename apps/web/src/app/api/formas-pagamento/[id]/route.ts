// PATCH /api/formas-pagamento/[id]   — atualiza canal e observacao
// DELETE /api/formas-pagamento/[id]  — remove (forma volta a ser auto-criada
//   na próxima ingestão como ADQUIRENTE default)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { CANAIS_LIQUIDACAO } from '@/lib/canal-liquidacao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  canal: z.enum(CANAIS_LIQUIDACAO).optional(),
  observacao: z.string().max(500).nullable().optional(),
});

async function carregar(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 as const, error: 'id invalido' };
  const [linha] = await db
    .select()
    .from(schema.formaPagamentoCanal)
    .where(eq(schema.formaPagamentoCanal.id, id))
    .limit(1);
  if (!linha) return { status: 404 as const, error: 'forma nao encontrada' };
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        eq(schema.usuarioFilial.filialId, linha.filialId),
      ),
    )
    .limit(1);
  if (!link) return { status: 403 as const, error: 'sem acesso' };
  return { status: 200 as const, linha };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const check = await carregar(id, user.id);
  if (check.status !== 200) return NextResponse.json({ error: check.error }, { status: check.status });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const set: Record<string, unknown> = { atualizadoEm: new Date() };
  if (parsed.data.canal !== undefined) {
    set.canal = parsed.data.canal;
    set.confirmadoPor = user.id;
    set.confirmadoEm = new Date();
  }
  if (parsed.data.observacao !== undefined) set.observacao = parsed.data.observacao;

  if (Object.keys(set).length === 1) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  await db.update(schema.formaPagamentoCanal).set(set).where(eq(schema.formaPagamentoCanal.id, id));
  return NextResponse.json({ id, ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const check = await carregar(id, user.id);
  if (check.status !== 200) return NextResponse.json({ error: check.error }, { status: check.status });

  await db.delete(schema.formaPagamentoCanal).where(eq(schema.formaPagamentoCanal.id, id));
  return NextResponse.json({ id, ok: true });
}
