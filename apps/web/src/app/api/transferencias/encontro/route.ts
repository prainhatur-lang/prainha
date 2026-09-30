// POST /api/transferencias/encontro — fecha o encontro de contas do mês.
// Body: { competencia: 'YYYY-MM', data: 'YYYY-MM-DD', vencimento? }
// Compensa as transferências abertas de cada par de casas e sobra 1 conta a
// pagar com a diferença na casa que deve (origem ENCONTRO_CONTAS).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { fecharEncontro, RecusaTransf } from '@/lib/transferencia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const pares = await fecharEncontro({ userId: user.id, ...parsed.data });
    return NextResponse.json({ ok: true, pares });
  } catch (e) {
    if (e instanceof RecusaTransf) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
