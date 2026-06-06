// PUT /api/reservas/regras — salva as regras de reserva (turnos por dia da
// semana + excecoes de calendario) de uma filial, mesclando com a config
// existente (preserva areas, valores e semOtp).
// Body: { filialId, turnosSemana: {0..6: [{hora,vagas}]}, excecoes: [{data,fechado?,turnos?}] }

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import type { ReservaConfig, TurnoReserva, ExcecaoReserva } from '@concilia/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HORA = /^\d{2}:\d{2}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeTurnos(arr: unknown): TurnoReserva[] {
  if (!Array.isArray(arr)) return [];
  const out: TurnoReserva[] = [];
  for (const t of arr) {
    const hora = typeof t?.hora === 'string' && HORA.test(t.hora) ? t.hora : null;
    const vagas = Number.isFinite(t?.vagas) ? Math.max(0, Math.min(99999, Math.trunc(t.vagas))) : null;
    if (hora && vagas !== null) out.push({ hora, vagas });
  }
  // ordena por hora e remove horas duplicadas (mantem a primeira)
  out.sort((a, b) => a.hora.localeCompare(b.hora));
  return out.filter((t, i, a) => i === 0 || t.hora !== a[i - 1].hora);
}

export async function PUT(request: Request) {
  const { user, error } = await exigirPermApi('reserva.configurar');
  if (error) return error;

  const b = await request.json().catch(() => null);
  const filialId = typeof b?.filialId === 'string' ? b.filialId : null;
  if (!filialId) return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  // turnos por dia da semana (0..6)
  const turnosSemana: Record<number, TurnoReserva[]> = {};
  if (b?.turnosSemana && typeof b.turnosSemana === 'object') {
    for (let dia = 0; dia <= 6; dia++) {
      const t = sanitizeTurnos((b.turnosSemana as Record<string, unknown>)[String(dia)]);
      if (t.length) turnosSemana[dia] = t;
    }
  }

  // excecoes de calendario
  const excecoes: ExcecaoReserva[] = [];
  if (Array.isArray(b?.excecoes)) {
    for (const e of b.excecoes) {
      const data = typeof e?.data === 'string' && DATA.test(e.data) ? e.data : null;
      if (!data) continue;
      const turnos = sanitizeTurnos(e?.turnos);
      const ex: ExcecaoReserva = { data };
      if (e?.fechado) ex.fechado = true;
      if (!ex.fechado && turnos.length) ex.turnos = turnos;
      excecoes.push(ex);
    }
  }

  // Mescla com a config atual (NAO sobrescreve areas/valores/semOtp).
  const [row] = await db
    .select({ reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const atual: ReservaConfig = row?.reservaConfig ?? { areas: [] };

  const nova: ReservaConfig = {
    ...atual,
    areas: atual.areas ?? [],
    turnosSemana,
    excecoes,
  };

  await db
    .update(schema.filial)
    .set({ reservaConfig: nova })
    .where(and(eq(schema.filial.id, filialId), inArray(schema.filial.id, filiais.map((f) => f.id))));

  return NextResponse.json({ ok: true, turnosSemana, excecoes });
}
