// GET/POST /api/financeiro/pedidos-pix/comprovante-modelo — modelo
// `comprovante_pix` na Meta (03/11/2026). GET diz se existe/aprovado; POST
// cria (botão "Criar modelo do comprovante" na tela de Pix enviados). Só Admin.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { podePagarPix } from '@/lib/pix-pagamento';
import { criarModeloComprovante, estadoModeloComprovante } from '@/lib/pix-comprovante-modelo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function guarda() {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  if (!(await podePagarPix(user.id))) {
    return NextResponse.json({ error: 'Só o Admin mexe nos Pix enviados pelo sistema.' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const barrado = await guarda();
  if (barrado) return barrado;
  return NextResponse.json({ envVar: !!process.env.WHATSAPP_COMPROVANTE_TEMPLATE, ...(await estadoModeloComprovante(true)) });
}

export async function POST() {
  const barrado = await guarda();
  if (barrado) return barrado;
  return NextResponse.json(await criarModeloComprovante());
}
