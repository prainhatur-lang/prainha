// POST /api/recibo-foto/[token] — foto do recibo assinado tirada pelo celular
// (QR da tela do recibo). Sem login: o link é assinado, só sobe arquivo pra
// conta dele e vence em 24 h. multipart/form-data com 'arquivo'.

import { NextResponse } from 'next/server';
import { carregarRecibo } from '@/lib/recibo-avulso';
import { contaDoTokenFoto, guardarReciboAssinado } from '@/lib/recibo-assinado';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const contaId = contaDoTokenFoto((await ctx.params).token);
  if (!contaId) return NextResponse.json({ error: 'link vencido — abra o QR de novo na tela do recibo' }, { status: 403 });
  const r = await carregarRecibo(contaId);
  if (!r) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const falha = await guardarReciboAssinado(r.filialId, r.contaId, form?.get('arquivo'));
  if (falha) return NextResponse.json({ error: falha.erro }, { status: falha.status });
  return NextResponse.json({ ok: true }, { status: 201 });
}
