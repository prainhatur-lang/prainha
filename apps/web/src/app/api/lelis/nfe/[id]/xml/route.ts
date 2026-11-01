// GET /api/lelis/nfe/[id]/xml — XML (nfeProc) da NF-e de venda da Lelis.
import { NextResponse } from 'next/server';
import { acessoLelisApi } from '@/lib/lelis/acesso';
import { nfeVendaLelisPorId } from '@/lib/nfe/emitir-venda';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const nota = await nfeVendaLelisPorId(a.filialId, id);
  if (!nota?.xml) return NextResponse.json({ error: 'nota sem XML' }, { status: 404 });
  return new NextResponse(nota.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nota.chave}-nfe.xml"`,
    },
  });
}
