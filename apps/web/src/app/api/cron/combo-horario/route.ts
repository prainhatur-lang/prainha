// GET /api/cron/combo-horario — de 5 em 5 min aplica o horário dos combos
// (combo_regra): fora da regra pausa o tamanho pela fila produto_alteracao,
// dentro despausa. Só age na virada — ver lib/combo-horario.
// Também aplica o preço por horário (lib/preco-horario).
import { NextResponse } from 'next/server';
import { aplicarHorarios } from '@/lib/combo-horario';
import { aplicarPrecosHorario } from '@/lib/preco-horario';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const feitos = await aplicarHorarios();
  // Preço por horário (30/10): mesmo relógio, troca o preço na virada.
  const precos = await aplicarPrecosHorario().catch((e) => [{ erro: e instanceof Error ? e.message : String(e) }]);
  return NextResponse.json({ ok: true, feitos, precos });
}
