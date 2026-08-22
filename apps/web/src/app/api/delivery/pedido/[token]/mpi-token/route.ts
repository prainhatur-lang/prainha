// GET /api/delivery/pedido/[token]/mpi-token — access_token MPI (3DS) +
// config pública pro checkout de cartão do delivery. Público (token do
// pedido), igual ao fluxo de reserva.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { getCieloMpiAccessToken, getCieloMpiPublicConfig } from '@/lib/cielo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token inválido' }, { status: 404 });
  }

  const [pedido] = await db
    .select({ id: schema.deliveryPedido.id, filialId: schema.deliveryPedido.filialId })
    .from(schema.deliveryPedido)
    .where(eq(schema.deliveryPedido.token, token))
    .limit(1);
  if (!pedido) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 });

  try {
    const accessToken = await getCieloMpiAccessToken(pedido.filialId);
    const config = await getCieloMpiPublicConfig(pedido.filialId);
    return NextResponse.json({
      accessToken,
      establishmentCode: config.establishmentCode,
      merchantName: config.merchantName,
      mcc: config.mcc,
      environment: config.environment,
      scriptUrl: config.scriptUrl,
    });
  } catch (e) {
    console.error('[delivery mpi-token]', (e as Error).message);
    return NextResponse.json({ error: 'erro ao obter token MPI' }, { status: 500 });
  }
}
