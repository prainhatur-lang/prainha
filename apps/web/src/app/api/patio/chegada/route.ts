// POST /api/patio/chegada — agente-patio chama isso quando a LPR lê uma
// placa na ENTRADA. Se bater com a placa de alguma reserva ativa de hoje,
// marca placa_chegada_em na reserva — a tela /reservas (quando aberta)
// avisa a recepção com som na hora (polling em GET /api/reservas/chegadas).
//
// Auth: Bearer <agente_token> — mesmo token/convenção do agente-local
// (filial.agenteToken), não é sessão de usuário.

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalizarPlaca(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return new NextResponse('token inválido', { status: 401 });
  const token = auth.slice(7).trim();

  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.agenteToken, token))
    .limit(1);
  if (!filial) return new NextResponse('token inválido', { status: 401 });

  const b = await req.json().catch(() => null);
  const placaBruta = typeof b?.placa === 'string' ? b.placa : '';
  const placa = normalizarPlaca(placaBruta);
  if (!placa) return NextResponse.json({ ok: true, bateu: false });

  const candidatas = await db
    .select({ id: schema.reserva.id, placaVeiculo: schema.reserva.placaVeiculo })
    .from(schema.reserva)
    .where(
      and(
        eq(schema.reserva.filialId, filial.id),
        eq(schema.reserva.data, hojeBr()),
        inArray(schema.reserva.status, ['pendente', 'confirmada', 'sentada']),
      ),
    );

  const bateram = candidatas.filter((r) => r.placaVeiculo && normalizarPlaca(r.placaVeiculo) === placa);
  if (bateram.length === 0) return NextResponse.json({ ok: true, bateu: false });

  await db
    .update(schema.reserva)
    .set({ placaChegadaEm: sql`now()` })
    .where(inArray(schema.reserva.id, bateram.map((r) => r.id)));

  return NextResponse.json({ ok: true, bateu: true, reservas: bateram.map((r) => r.id) });
}
