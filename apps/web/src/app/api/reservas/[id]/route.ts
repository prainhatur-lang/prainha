// PATCH /api/reservas/[id] — atualiza status / mesa / area de uma reserva.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { mesaEstaLivre } from '@/lib/reservas/mesa-disponivel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS = new Set(['pendente', 'confirmada', 'sentada', 'cancelada', 'no_show', 'concluida']);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('reserva.update');
  if (error) return error;

  const { id } = await params;
  const b = await request.json().catch(() => null);

  const set: Record<string, unknown> = { atualizadoEm: sql`now()` };
  if (typeof b?.status === 'string') {
    if (!STATUS.has(b.status)) return NextResponse.json({ error: 'status inválido' }, { status: 400 });
    set.status = b.status;
  }
  if (b?.mesa !== undefined) set.mesa = typeof b.mesa === 'string' && b.mesa.trim() ? b.mesa.trim().slice(0, 20) : null;
  if (b?.area !== undefined) set.area = typeof b.area === 'string' && b.area.trim() ? b.area.trim().slice(0, 100) : null;
  if (b?.observacao !== undefined)
    set.observacao = typeof b.observacao === 'string' && b.observacao.trim() ? b.observacao.trim().slice(0, 2000) : null;
  if (b?.preferencias !== undefined)
    set.preferencias = typeof b.preferencias === 'string' && b.preferencias.trim() ? b.preferencias.trim().slice(0, 500) : null;
  if (typeof b?.bebidaConfirmada === 'boolean') set.bebidaConfirmada = b.bebidaConfirmada;
  if (b?.bebidaPedido !== undefined)
    set.bebidaPedido = typeof b.bebidaPedido === 'string' && b.bebidaPedido.trim() ? b.bebidaPedido.trim().slice(0, 100) : null;

  if (Object.keys(set).length === 1) {
    return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 });
  }

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  if (filialIds.length === 0) return NextResponse.json({ error: 'sem filiais' }, { status: 403 });

  // Troca de mesa (recepção): a nova mesa não pode já estar ocupada por outra
  // reserva ativa no mesmo espaço/data. Só checa quando uma mesa está sendo
  // atribuída (null = "tirar a mesa", sempre permitido).
  if (typeof set.mesa === 'string') {
    const [atual] = await db
      .select({ filialId: schema.reserva.filialId, data: schema.reserva.data, area: schema.reserva.area, mesa: schema.reserva.mesa })
      .from(schema.reserva)
      .where(and(eq(schema.reserva.id, id), inArray(schema.reserva.filialId, filialIds)))
      .limit(1);
    if (!atual) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
    const areaFinal = (typeof set.area === 'string' ? set.area : atual.area) as string | null;
    // Mantendo a mesma mesa que já tinha: sempre permitido, mesmo que o
    // Consumer mostre ela como ocupada (é a própria comanda dessa reserva).
    if (areaFinal && set.mesa !== atual.mesa) {
      const livre = await mesaEstaLivre({
        filialId: atual.filialId,
        data: atual.data,
        area: areaFinal,
        mesa: set.mesa,
        excluirReservaId: id,
      });
      if (!livre) {
        return NextResponse.json(
          { error: `Mesa ${set.mesa} já está ocupada em ${areaFinal} nessa data.` },
          { status: 409 },
        );
      }
    }
  }

  const upd = await db
    .update(schema.reserva)
    .set(set)
    .where(and(eq(schema.reserva.id, id), inArray(schema.reserva.filialId, filialIds)))
    .returning({ id: schema.reserva.id });

  if (upd.length === 0) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
