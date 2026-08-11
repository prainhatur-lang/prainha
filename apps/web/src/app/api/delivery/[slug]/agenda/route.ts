// GET /api/delivery/[slug]/agenda — calendário de dias e horários agendáveis
// do delivery (+ se "o quanto antes" está disponível agora). Público.

import { NextResponse } from 'next/server';
import { lojaDeliveryPorSlug, agendaDelivery } from '@/lib/delivery/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loja = await lojaDeliveryPorSlug(slug);
  if (!loja) return NextResponse.json({ error: 'loja não encontrada' }, { status: 404 });

  const { dias, asapDisponivel } = agendaDelivery(loja.config);
  return NextResponse.json({
    dias,
    asapDisponivel,
    pausado: loja.config.pausado === true,
    tempoPreparoMin: loja.config.tempoPreparoMin ?? null,
    tempoPreparoMax: loja.config.tempoPreparoMax ?? null,
  });
}
