// PATCH /api/atendimento/eventos/[id] — muda o status do lead.
// Body: { status: 'novo' | 'em_contato' | 'fechado' | 'perdido' }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS = new Set(['novo', 'em_contato', 'fechado', 'perdido']);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('atendimento.responder');
  if (error) return error;
  const { id } = await params;

  const b = await request.json().catch(() => null);
  const status = typeof b?.status === 'string' ? b.status : '';
  if (!STATUS.has(status)) return NextResponse.json({ error: 'status inválido' }, { status: 400 });

  const [lead] = await db.select().from(schema.eventoLead).where(eq(schema.eventoLead.id, id)).limit(1);
  if (!lead) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === lead.filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  await db
    .update(schema.eventoLead)
    .set({ status, atualizadoEm: sql`now()` })
    .where(eq(schema.eventoLead.id, id));
  return NextResponse.json({ ok: true, status });
}
