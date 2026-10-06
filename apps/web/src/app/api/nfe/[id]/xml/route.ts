// GET /api/nfe/[id]/xml — baixa o XML (nfeProc) de uma NF-e emitida a partir
// de cupom. A da transferência tem a rota dela em /api/transferencias.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('nfce.read');
  if (error) return error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });

  const [nota] = await db
    .select({ filialId: schema.nfeEmitida.filialId, chave: schema.nfeEmitida.chave, xml: schema.nfeEmitida.xml })
    .from(schema.nfeEmitida)
    .where(and(eq(schema.nfeEmitida.id, id), isNotNull(schema.nfeEmitida.nfceOrigemId)))
    .limit(1);
  if (!nota?.xml) return NextResponse.json({ error: 'nota sem XML' }, { status: 404 });
  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, nota.filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'nota não encontrada' }, { status: 404 });

  return new NextResponse(nota.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nota.chave}-nfe.xml"`,
    },
  });
}
