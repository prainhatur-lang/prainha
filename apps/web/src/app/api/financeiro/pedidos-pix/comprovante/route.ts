// GET /api/financeiro/pedidos-pix/comprovante?id=&x=&s= — PDF do comprovante
// do Pix pago pelo sistema. Público (a Meta baixa o arquivo pra mandar no
// WhatsApp, e o wa.me leva o link): a defesa é a assinatura HMAC com validade.

import { NextResponse } from 'next/server';
import {
  conferirLinkComprovante,
  dadosComprovantePix,
  nomeArquivoComprovante,
  pdfComprovantePix,
} from '@/lib/pix-comprovante-whatsapp';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !conferirLinkComprovante(id, u.searchParams.get('x') ?? '', u.searchParams.get('s') ?? '')) {
    return NextResponse.json({ error: 'link inválido ou vencido' }, { status: 403 });
  }
  const d = await dadosComprovantePix(id);
  if (!d) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  const pdf = pdfComprovantePix(d);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nomeArquivoComprovante(d)}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
