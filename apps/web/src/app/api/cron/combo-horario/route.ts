// GET /api/cron/combo-horario — de 5 em 5 min aplica o horário dos combos
// (combo_regra): fora da regra pausa o tamanho pela fila produto_alteracao,
// dentro despausa. Só age na virada — ver lib/combo-horario.
// Também aplica o preço por horário (lib/preco-horario) e o paga 1 leva 2
// por horário (lib/promo-leve2) e conclui as permutas (lib/permuta).
import { NextResponse } from 'next/server';
import { aplicarHorarios } from '@/lib/combo-horario';
import { aplicarPrecosHorario } from '@/lib/preco-horario';
import { aplicarLeve2 } from '@/lib/promo-leve2';
import { processarPermutas } from '@/lib/permuta';

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
  // Paga 1 leva 2 por horário (31/10): liga/desliga o chope dobrado na virada.
  const leve2 = await aplicarLeve2().catch((e) => [{ erro: e instanceof Error ? e.message : String(e) }]);
  // Permutas (31/10): lança o crédito quando a loja devolve o cadastro do parceiro.
  const permutas = await processarPermutas().catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
  return NextResponse.json({ ok: true, feitos, precos, leve2, permutas });
}
