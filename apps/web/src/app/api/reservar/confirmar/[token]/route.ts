// POST /api/reservar/confirmar/[token] — cliente confirma presença via token
// (link do lembrete da véspera). Público (token = autenticação).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ error: 'token inválido' }, { status: 404 });

  const upd = await db
    .update(schema.reserva)
    .set({ status: 'confirmada', confirmadaClienteEm: sql`now()`, atualizadoEm: sql`now()` })
    .where(and(eq(schema.reserva.cancelToken, token), sql`${schema.reserva.status} <> 'cancelada'`))
    .returning({ id: schema.reserva.id });

  if (upd.length === 0) {
    const [r] = await db
      .select({ id: schema.reserva.id, status: schema.reserva.status })
      .from(schema.reserva)
      .where(eq(schema.reserva.cancelToken, token))
      .limit(1);
    if (!r) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
    return NextResponse.json({ error: 'reserva cancelada' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
