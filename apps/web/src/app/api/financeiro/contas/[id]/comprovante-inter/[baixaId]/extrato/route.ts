// GET → PDF oficial do extrato do Inter (da conta que pagou) no dia do pagamento
// desta baixa. Quem vê a conta a pagar baixa o extrato do dia.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filialIdsDoUsuario } from '@/lib/comprovante-loterica';
import {
  baixaDaConta,
  credExtratoDaCasa,
  montarComprovanteInter,
  origemInterDasBaixas,
} from '@/lib/comprovante-inter';
import { exportarExtratoPdfInter } from '@/lib/inter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; baixaId: string }> }) {
  const auth = await exigirPermApi('conta_pagar.read');
  if (auth.error) return auth.error;
  const { id, baixaId } = await params;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(id) || !uuid.test(baixaId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });

  const b = await baixaDaConta(id, baixaId);
  if (!b) return NextResponse.json({ error: 'pagamento não encontrado' }, { status: 404 });
  const filiais = await filialIdsDoUsuario(auth.user.id);
  if (!filiais.includes(b.contaFilialId)) return NextResponse.json({ error: 'sem acesso à casa da conta' }, { status: 403 });

  const tipo = (await origemInterDasBaixas([b])).get(b.id);
  if (!tipo) return NextResponse.json({ error: 'este pagamento não foi pelo Inter' }, { status: 404 });
  const comp = await montarComprovanteInter(id, b, tipo);
  const casa = comp.filialPagadoraId ?? b.contaFilialId;
  const data = comp.data ?? b.data;
  const cred = credExtratoDaCasa(casa);
  if (!cred) return NextResponse.json({ error: 'casa sem credencial do Inter' }, { status: 404 });

  try {
    const pdf = await exportarExtratoPdfInter(cred, data, data);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="extrato-inter-${data}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `Inter não devolveu o extrato: ${(e as Error).message}` }, { status: 502 });
  }
}
