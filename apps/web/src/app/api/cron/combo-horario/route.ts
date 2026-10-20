// GET /api/cron/combo-horario — de 5 em 5 min aplica o horário dos combos
// (combo_regra): fora da regra pausa o tamanho pela fila produto_alteracao,
// dentro despausa. Só age na virada — ver lib/combo-horario.
import { NextResponse } from 'next/server';
import { aplicarHorarios } from '@/lib/combo-horario';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const feitos = await aplicarHorarios();
  return NextResponse.json({ ok: true, feitos });
}
