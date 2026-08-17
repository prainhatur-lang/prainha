// POST /api/cotacao/[id]/prazo — { horas }
// Ajusta o prazo de resposta de uma cotação ABERTA: fechaEm = agora + horas.
// Pro dia de compra apertado ("preciso pedir tudo hoje") sem recriar a cotação.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cotacao.update');
  if (semPerm) return semPerm;

  const { id } = await params;

  let body: { horas?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const horas = Number(body.horas);
  if (!Number.isFinite(horas) || horas <= 0 || horas > 24 * 7) {
    return NextResponse.json({ error: 'horas invalido (0 < horas <= 168)' }, { status: 400 });
  }

  const [c] = await db
    .select({ id: schema.cotacao.id, status: schema.cotacao.status })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, id))
    .limit(1);
  if (!c) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  if (c.status !== 'ABERTA') {
    return NextResponse.json({ error: `cotacao ${c.status} — so ABERTA muda prazo` }, { status: 400 });
  }

  const fechaEm = new Date(Date.now() + horas * 60 * 60 * 1000);
  await db
    .update(schema.cotacao)
    .set({ fechaEm, duracaoHoras: Math.ceil(horas) })
    .where(eq(schema.cotacao.id, id));

  return NextResponse.json({ ok: true, fechaEm: fechaEm.toISOString() });
}
