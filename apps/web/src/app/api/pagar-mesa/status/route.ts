// GET /api/pagar-mesa/status — o vendas-local pergunta se a mesa ja pagou.
// Mesma assinatura HMAC do link: a loja nao tem login aqui.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { lerParams } from '@/lib/pagar-mesa';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const p = lerParams(new URL(request.url).searchParams);
  if (!p) return NextResponse.json({ error: 'link inválido ou expirado' }, { status: 403 });
  const [c] = await db
    .select()
    .from(schema.cobrancaMesa)
    .where(eq(schema.cobrancaMesa.ref, p.ref))
    .limit(1);
  if (!c) return NextResponse.json({ ok: true, pago: false, status: 'aguardando' });
  return NextResponse.json({
    ok: true,
    pago: c.status === 'pago',
    status: c.status,
    valor_centavos: c.valorCentavos,
    tipo: c.tipoPagamento,
    bandeira: c.bandeira,
    autorizacao: c.paymentId,
    erro: c.erro,
  });
}
