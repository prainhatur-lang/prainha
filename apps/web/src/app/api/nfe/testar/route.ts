// POST /api/nfe/testar — pinga o serviço de NF-e (modelo 55) da SVRS com o
// certificado da casa (107 = ok). É o teste da nota de TRANSFERÊNCIA; o da
// NFC-e continua em /api/nfce/testar.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { testarNfe } from '@/lib/nfe/emitir';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({ filialId: z.string().uuid() });

export async function POST(request: Request) {
  const auth = await exigirPermApi('configuracao.read');
  if (auth.error) return auth.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'body inválido' }, { status: 400 });
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(eq(schema.usuarioFilial.usuarioId, auth.user.id), eq(schema.usuarioFilial.filialId, parsed.data.filialId)),
    )
    .limit(1);
  if (!link) return NextResponse.json({ ok: false, erro: 'sem acesso' }, { status: 403 });
  return NextResponse.json(await testarNfe(parsed.data.filialId));
}
