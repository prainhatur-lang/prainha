// PUT /api/reservas/config — salva os espaços + hora limite de uma filial.
// Body: { filialId, areas: [{ nome, ativo, somenteEventos?, horaLimite? }] }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import type { AreaReserva, ReservaConfig } from '@concilia/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(request: Request) {
  const { user, error } = await exigirPermApi('reserva.configurar');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  if (!filialId || !Array.isArray(b?.areas)) {
    return NextResponse.json({ error: 'filialId e areas[] obrigatórios' }, { status: 400 });
  }

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  // Config atual: preserva valores/semOtp/turnos/excecoes e as mesas ja
  // cadastradas por area (a edicao de areas nao mexe nas mesas fisicas).
  const [row] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const atual: ReservaConfig = row?.reservaConfig ?? { areas: [] };
  const mesasPorArea = new Map<string, AreaReserva['mesas']>();
  for (const a of atual.areas ?? []) if (a?.nome) mesasPorArea.set(a.nome, a.mesas);

  const areas: AreaReserva[] = [];
  for (const a of b.areas) {
    const nome = typeof a?.nome === 'string' ? a.nome.trim().slice(0, 100) : '';
    if (!nome) continue;
    const hl = typeof a?.horaLimite === 'string' && /^\d{2}:\d{2}$/.test(a.horaLimite) ? a.horaLimite : undefined;
    const pct = Number.isFinite(a?.percentualReserva)
      ? Math.max(0, Math.min(100, Math.trunc(a.percentualReserva)))
      : undefined;
    const mesas = mesasPorArea.get(nome);
    areas.push({
      nome,
      ativo: a?.ativo !== false,
      ...(a?.somenteEventos ? { somenteEventos: true } : {}),
      ...(hl ? { horaLimite: hl } : {}),
      ...(pct !== undefined ? { percentualReserva: pct } : {}),
      ...(mesas ? { mesas } : {}),
    });
  }

  await db
    .update(schema.filial)
    .set({ reservaConfig: { ...atual, areas } })
    .where(and(eq(schema.filial.id, filialId), inArray(schema.filial.id, filiais.map((f) => f.id))));

  return NextResponse.json({ ok: true, areas });
}
