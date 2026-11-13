// GET /api/financeiro/pedidos-pix/comprovante?id=&x=&s= — PDF do comprovante
// do Pix pago pelo sistema. Público (a Meta baixa o arquivo pra mandar no
// WhatsApp, e o wa.me leva o link): a defesa é a assinatura HMAC com validade.

import { NextResponse } from 'next/server';
import {
  conferirLinkComprovante,
  conferirLinkComprovanteComBordero,
  dadosComprovantePix,
  nomeArquivoComprovante,
  pdfComprovantePix,
} from '@/lib/pix-comprovante-whatsapp';
import { relacoesDoPix } from '@/lib/bordero-relacao';
import { agoraBrBordero, nomeArquivoBordero, pdfBordero } from '@/lib/bordero-pdf';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get('id') ?? '';

  // `b=1` — Pix de borderô pro intermediário (lotérica): o mesmo comprovante na
  // 1ª página e a relação de quem recebe (nome, CPF, conta, valor) nas
  // seguintes. Assinatura própria; o link sem `b` segue igual, logo abaixo.
  if (u.searchParams.get('b') === '1') {
    if (
      !/^[0-9a-f-]{36}$/i.test(id) ||
      !conferirLinkComprovanteComBordero(id, u.searchParams.get('x') ?? '', u.searchParams.get('s') ?? '')
    ) {
      return NextResponse.json({ error: 'link inválido ou vencido' }, { status: 403 });
    }
    const dd = await dadosComprovantePix(id);
    if (!dd.ok) return NextResponse.json({ error: dd.motivo }, { status: 409 });
    const relacoes = await relacoesDoPix(id);
    if (relacoes.length === 0) {
      return NextResponse.json({ error: 'este Pix não pagou nenhum borderô' }, { status: 409 });
    }
    const pdf = pdfBordero({ comprovante: dd.dados, relacoes, geradoEm: agoraBrBordero() });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${nomeArquivoBordero({ comprovante: dd.dados, relacoes })}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  if (!/^[0-9a-f-]{36}$/i.test(id) || !conferirLinkComprovante(id, u.searchParams.get('x') ?? '', u.searchParams.get('s') ?? '')) {
    return NextResponse.json({ error: 'link inválido ou vencido' }, { status: 403 });
  }
  // Consulta o Inter na hora: só sai PDF com o Pix efetivado lá.
  const dd = await dadosComprovantePix(id);
  if (!dd.ok) return NextResponse.json({ error: dd.motivo }, { status: 409 });
  const d = dd.dados;
  const pdf = pdfComprovantePix(d);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nomeArquivoComprovante(d)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
