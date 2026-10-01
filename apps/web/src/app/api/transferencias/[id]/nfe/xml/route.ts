// GET /api/transferencias/[id]/nfe/xml?nfeId=… — baixa o XML (nfeProc) da
// NF-e da transferência, pro contador. Quem enviou e quem recebeu podem baixar.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('nota_compra.read');
  if (error) return error;
  const { id } = await params;
  const nfeId = new URL(req.url).searchParams.get('nfeId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(nfeId)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }
  const [nota] = await db
    .select()
    .from(schema.nfeEmitida)
    .where(and(eq(schema.nfeEmitida.id, nfeId), eq(schema.nfeEmitida.transferenciaId, id)))
    .limit(1);
  if (!nota?.xml) return NextResponse.json({ error: 'nota sem XML' }, { status: 404 });
  const casas = [nota.filialId, ...(nota.filialDestinoId ? [nota.filialDestinoId] : [])];
  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), inArray(schema.usuarioFilial.filialId, casas)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  return new NextResponse(nota.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nota.chave}-nfe.xml"`,
    },
  });
}
