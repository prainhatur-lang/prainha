// GET /api/reservar/[token]/disponibilidade?data=YYYY-MM-DD
// Público. Retorna, por espaço, quantas MESAS estão livres naquele dia
// (a mesa é a unidade: reservada = fora do estoque). Pro link mostrar a
// disponibilidade antes do cliente escolher.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { foraDaJanelaAtendimento } from '@/lib/reservas/atendimento';
import { mesasOcupadas } from '@/lib/reservas/mesa-disponivel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface MesaCfg { numero: string | number; lugares: number }
interface AreaCfg { nome: string; ativo?: boolean; somenteEventos?: boolean; mesas?: MesaCfg[]; percentualReserva?: number }

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return NextResponse.json({ areas: [], fechado: false });

  // Pausa por dia: exceção de calendário com fechado=true pra essa data
  // específica (ex: "hoje lotou") — não afeta outros dias.
  const fechado = !!filial.reservaConfig?.excecoes?.some((e) => e.data === data && e.fechado);
  if (fechado) return NextResponse.json({ areas: [], fechado: true });

  // Janela de atendimento do sistema (horário de funcionamento das reservas).
  const janela = await foraDaJanelaAtendimento(filial.reservaConfig, data);
  if (janela.bloqueado) return NextResponse.json({ areas: [], fechado: true, motivo: janela.motivo });

  const areas = ((filial.reservaConfig?.areas as AreaCfg[] | undefined) ?? []).filter(
    (a) => a.ativo && !a.somenteEventos && (a.mesas?.length ?? 0) > 0,
  );
  if (areas.length === 0) return NextResponse.json({ areas: [], fechado: false });

  // Ocupação por área: reserva ativa + ocupação real no Consumer (se hoje) —
  // mesma fonte usada pra alocar mesa de verdade no /confirmar, evita a
  // disponibilidade mostrada divergir do que realmente é aceito.
  const out = await Promise.all(
    areas.map(async (a) => {
      const total = a.mesas!.length;
      const ocupadas = (await mesasOcupadas({ filialId: filial.id, data, area: a.nome })).size;
      const limite = typeof a.percentualReserva === 'number' ? Math.floor((total * a.percentualReserva) / 100) : total;
      return { nome: a.nome, total, livres: Math.max(0, limite - ocupadas) };
    }),
  );

  return NextResponse.json({ areas: out, fechado: false });
}
