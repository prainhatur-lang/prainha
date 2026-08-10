// GET /api/nfce/[id]/xml — baixa o XML da NFC-e (nfeProc autorizado).
// Guarda legal é do emitente: o XML mora no banco e sai por aqui pro contador.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await exigirPermApi('nfce.read');
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [nota] = await db
    .select({
      filialId: schema.nfceEmitida.filialId,
      chave: schema.nfceEmitida.chave,
      xml: schema.nfceEmitida.xml,
    })
    .from(schema.nfceEmitida)
    .where(eq(schema.nfceEmitida.id, id))
    .limit(1);
  if (!nota?.xml) return NextResponse.json({ error: 'sem XML' }, { status: 404 });

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, auth.user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  return new NextResponse(nota.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nota.chave}-nfce.xml"`,
    },
  });
}
