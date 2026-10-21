// GET /api/cron/reservas-do-dia — todo dia às 07:00 (BRT) manda a lista de
// reservas de HOJE pra quem cuida de cada casa (chefe de cozinha, gerente de
// salão, bar) e pro dono/gerente com todas. Quem recebe é cadastrado em
// /relatorios/diario ("Reservas do dia"). Pedido do dono 20/10/2026.

import { NextResponse } from 'next/server';
import { hojeBr } from '@/lib/datas';
import { enviarReservasDeHojeTodas } from '@/lib/reservas-do-dia-envio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dia = hojeBr();
  const envios = await enviarReservasDeHojeTodas(dia);
  return NextResponse.json({ ok: true, dia, envios });
}
