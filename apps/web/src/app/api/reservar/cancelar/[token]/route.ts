// POST /api/reservar/cancelar/[token] — cliente cancela a propria reserva via token.
// Publico (o token = autenticacao). Libera a mesa (status -> cancelada).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { estornarReservaSePago } from '@/lib/reservas/estorno';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ error: 'token inválido' }, { status: 404 });

  const upd = await db
    .update(schema.reserva)
    .set({ status: 'cancelada', atualizadoEm: sql`now()` })
    .where(and(eq(schema.reserva.cancelToken, token), sql`${schema.reserva.status} <> 'cancelada'`))
    .returning({
      id: schema.reserva.id,
      data: schema.reserva.data,
      hora: schema.reserva.hora,
      pagamentoStatus: schema.reserva.pagamentoStatus,
      pagamentoId: schema.reserva.pagamentoId,
      pagamentoValor: schema.reserva.pagamentoValor,
    });

  if (upd.length === 0) {
    // pode ja estar cancelada ou token invalido — verifica existencia
    const [r] = await db
      .select({ id: schema.reserva.id })
      .from(schema.reserva)
      .where(eq(schema.reserva.cancelToken, token))
      .limit(1);
    if (!r) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  // Lounge pago: aplica a regra de estorno (48h+ integral / 24-48h 50% /
  // <24h retido) — automático, best-effort.
  const estorno = await estornarReservaSePago({ ...upd[0], data: String(upd[0].data) }).catch(() => null);
  return NextResponse.json({ ok: true, estorno: estorno?.rotulo ?? null });
}
