// GET /api/reservar/[token]/mpi-token — devolve access_token MPI (3DS) +
// config pública pro frontend inicializar window.bpmpi_config antes de
// chamar bpmpi_authenticate(). Público (token = filial), sem sessão —
// o fluxo de reserva não tem login.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { getCieloMpiAccessToken, getCieloMpiPublicConfig } from '@/lib/cielo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ error: 'token inválido' }, { status: 404 });

  const [filial] = await db
    .select({ id: schema.filial.id })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });

  try {
    const accessToken = await getCieloMpiAccessToken();
    const config = getCieloMpiPublicConfig();
    return NextResponse.json({
      accessToken,
      establishmentCode: config.establishmentCode,
      merchantName: config.merchantName,
      mcc: config.mcc,
      environment: config.environment,
      scriptUrl: config.scriptUrl,
    });
  } catch (e) {
    console.error('[mpi-token]', (e as Error).message);
    return NextResponse.json({ error: 'erro ao obter token MPI' }, { status: 500 });
  }
}
