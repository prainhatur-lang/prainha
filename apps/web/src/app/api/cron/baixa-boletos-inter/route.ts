// GET /api/cron/baixa-boletos-inter
// Dá baixa sozinho nos boletos pagos pelo Inter de cada casa (últimos 15 dias),
// com a mesma regra do "Baixar todas" de /financeiro/boletos-inter — ver
// lib/boletos-inter-baixa-auto. O que a tela deixa pra conferir continua lá.
// ?simular=1 só mostra o que baixaria.

import { NextResponse } from 'next/server';
import { baixarBoletosInterAuto, casasComBoletoInter } from '@/lib/boletos-inter-baixa-auto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const simular = new URL(req.url).searchParams.get('simular') === '1';
  const resultados = [];
  for (const casa of await casasComBoletoInter()) {
    try {
      resultados.push({ casa: casa.nome, ...(await baixarBoletosInterAuto({ filialId: casa.id, simular })) });
    } catch (e) {
      resultados.push({ casa: casa.nome, filialId: casa.id, erro: (e as Error).message });
    }
  }
  return NextResponse.json({ ok: true, simular, executadoEm: new Date().toISOString(), resultados });
}
