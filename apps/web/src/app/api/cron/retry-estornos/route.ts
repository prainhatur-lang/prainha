// GET /api/cron/retry-estornos
// Roda 1x/dia: reprocessa estornos que a Cielo negou (pagamento_status
// estorno_falhou_*). Caso clássico: Pix pago à noite, cancelado antes do
// repasse cair -> "Merchant with insufficient balance for return"; quando o
// saldo entra (repasse), o retry sai sozinho. Auth: Bearer CRON_SECRET.

import { NextResponse } from 'next/server';
import { reprocessarEstornosFalhos } from '@/lib/reservas/estorno';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const r = await reprocessarEstornosFalhos();
  if (r.ok > 0 || r.pendentes > 0) console.log('[retry-estornos]', JSON.stringify(r));
  return NextResponse.json(r);
}
