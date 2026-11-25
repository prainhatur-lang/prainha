// GET /api/link-pagamento/[token]/mpi-token — token do Braspag MPI pro 3DS.
// Público, mas só devolve pra um link de pagamento que existe e está aberto.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { getCieloMpiAccessToken, getCieloMpiPublicConfig } from '@/lib/cielo';
import { situacaoLinkPagamento } from '@/lib/link-pagamento';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const [link] = await db
    .select()
    .from(schema.linkPagamento)
    .where(eq(schema.linkPagamento.token, token))
    .limit(1);
  if (!link || situacaoLinkPagamento(link) !== 'aberto')
    return NextResponse.json({ error: 'link inválido ou expirado' }, { status: 403 });
  try {
    const accessToken = await getCieloMpiAccessToken(link.filialId);
    return NextResponse.json({ accessToken, ...(await getCieloMpiPublicConfig(link.filialId)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
