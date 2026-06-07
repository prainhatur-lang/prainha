// GET /api/reservar/[token]/disponibilidade?data=YYYY-MM-DD
// Público. Retorna, por espaço, quantas MESAS estão livres naquele dia
// (a mesa é a unidade: reservada = fora do estoque). Pro link mostrar a
// disponibilidade antes do cliente escolher.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface MesaCfg { numero: string | number; lugares: number }
interface AreaCfg { nome: string; ativo?: boolean; somenteEventos?: boolean; mesas?: MesaCfg[] }

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ areas: [] });

  const [filial] = await db
    .select({ id: schema.filial.id, reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ areas: [] });

  const data = new URL(request.url).searchParams.get('data') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return NextResponse.json({ areas: [] });

  const areas = ((filial.reservaConfig?.areas as AreaCfg[] | undefined) ?? []).filter(
    (a) => a.ativo && !a.somenteEventos && (a.mesas?.length ?? 0) > 0,
  );
  if (areas.length === 0) return NextResponse.json({ areas: [] });

  // Reservas ativas do dia com mesa
  const reservas = await db
    .select({ area: schema.reserva.area, mesa: schema.reserva.mesa })
    .from(schema.reserva)
    .where(
      and(
        eq(schema.reserva.filialId, filial.id),
        eq(schema.reserva.data, data),
        inArray(schema.reserva.status, ['pendente', 'confirmada', 'sentada']),
      ),
    );
  const ocupPorArea = new Map<string, Set<string>>();
  for (const r of reservas) {
    if (!r.area || !r.mesa) continue;
    if (!ocupPorArea.has(r.area)) ocupPorArea.set(r.area, new Set());
    ocupPorArea.get(r.area)!.add(String(r.mesa));
  }

  const out = areas.map((a) => {
    const total = a.mesas!.length;
    const ocupadas = ocupPorArea.get(a.nome)?.size ?? 0;
    return { nome: a.nome, total, livres: Math.max(0, total - ocupadas) };
  });

  return NextResponse.json({ areas: out });
}
