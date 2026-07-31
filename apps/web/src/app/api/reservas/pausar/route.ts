// PATCH /api/reservas/pausar — liga/desliga a pausa de reservas de UM DIA
// específico de uma filial (ex: "hoje lotou"). Body: { filialId, data,
// pausada: boolean }. Implementado via excecoes[].fechado — não mexe em
// outros dias nem no resto do reservaConfig (areas, turnos, etc).

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import type { ReservaConfig, ExcecaoReserva } from '@concilia/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(request: Request) {
  const { user, error } = await exigirPermApi('reserva.update');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  const data = typeof b?.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : null;
  const pausada = typeof b?.pausada === 'boolean' ? b.pausada : null;
  if (!filialId || !data || pausada === null) {
    return NextResponse.json({ error: 'filialId, data e pausada (boolean) obrigatórios' }, { status: 400 });
  }

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const [row] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const atual: ReservaConfig = row?.reservaConfig ?? { areas: [] };
  const excecoesSemEssaData = (atual.excecoes ?? []).filter((e) => e.data !== data);
  const excecoes: ExcecaoReserva[] = pausada ? [...excecoesSemEssaData, { data, fechado: true }] : excecoesSemEssaData;

  await db
    .update(schema.filial)
    .set({ reservaConfig: { ...atual, excecoes } })
    .where(and(eq(schema.filial.id, filialId), inArray(schema.filial.id, filiais.map((f) => f.id))));

  return NextResponse.json({ ok: true, data, pausada });
}
