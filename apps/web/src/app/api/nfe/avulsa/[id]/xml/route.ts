// GET /api/nfe/avulsa/[id]/xml — baixa o XML (nfeProc) de uma NF-e avulsa
// (venda de bem do imobilizado). É o arquivo que vai pro comprador e pro contador.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { temAcesso } from '@/lib/nfe/emitir';
import { nfeAvulsaPorId } from '@/lib/nfe/emitir-avulsa';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('nfce.read');
  if (error) return error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });

  const nota = await nfeAvulsaPorId(id);
  if (!nota?.xml) return NextResponse.json({ error: 'nota sem XML' }, { status: 404 });
  if (!(await temAcesso(user.id, nota.filialId))) return NextResponse.json({ error: 'nota não encontrada' }, { status: 404 });

  return new NextResponse(nota.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nota.chave}-nfe.xml"`,
    },
  });
}
