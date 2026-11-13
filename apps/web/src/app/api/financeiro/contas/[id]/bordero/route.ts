// GET → PDF do borderô da conta do intermediário (lotérica): a relação de quem
// recebe (nome, CPF, banco/agência/conta, valor). Se o Pix já saiu pelo sistema,
// o comprovante do Inter vai na 1ª página. Quem vê a conta vê o borderô dela.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { filiaisDoUsuario } from '@/lib/filiais';
import { borderoDaConta, pixPagoDaConta, relacaoDoBordero } from '@/lib/bordero-relacao';
import { agoraBrBordero, nomeArquivoBordero, pdfBordero } from '@/lib/bordero-pdf';
import { dadosComprovantePix } from '@/lib/pix-comprovante-whatsapp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi('conta_pagar.read');
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });

  const [conta] = await db
    .select({ filialId: schema.contaPagar.filialId })
    .from(schema.contaPagar)
    .where(eq(schema.contaPagar.id, id))
    .limit(1);
  if (!conta) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });
  const filiais = (await filiaisDoUsuario(auth.user.id)).map((f) => f.id);
  if (!filiais.includes(conta.filialId) && !(await ebLiberadaNoFinanceiro(auth.user.id, conta.filialId))) {
    return NextResponse.json({ error: 'sem acesso à casa da conta' }, { status: 403 });
  }

  const borderoId = await borderoDaConta(id);
  const relacao = borderoId ? await relacaoDoBordero(borderoId) : null;
  if (!relacao) return NextResponse.json({ error: 'esta conta não é de um borderô' }, { status: 404 });

  // Comprovante só entra se o Inter confirmar o Pix agora; senão sai o borderô sozinho.
  const pixId = await pixPagoDaConta(id, conta.filialId);
  const dd = pixId ? await dadosComprovantePix(pixId).catch(() => null) : null;
  const comprovante = dd?.ok ? dd.dados : null;
  const pdf = pdfBordero({ comprovante, relacoes: [relacao], geradoEm: agoraBrBordero() });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nomeArquivoBordero({ comprovante, relacoes: [relacao] })}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
