// GET /api/cron/relatorio-diario — todo dia às 07:00 (BRT) manda pro dono o
// relatório do dia anterior de todas as casas pelo WhatsApp (movimento, equipe
// pelo ponto, cancelamentos por demora, avaliações, pontos de atenção).
// Quem recebe é cadastrado em /relatorios/diario.

import { NextResponse } from 'next/server';
import { enviarRelatoriosDoDia } from '@/lib/relatorio-diario-envio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const envios = await enviarRelatoriosDoDia();
  return NextResponse.json({ ok: true, envios });
}
