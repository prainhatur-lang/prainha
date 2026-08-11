// POST /api/delivery/[slug]/cupom — valida um cupom no checkout. Público.
// A validação DEFINITIVA acontece de novo na criação do pedido.

import { NextResponse } from 'next/server';
import { lojaDeliveryPorSlug } from '@/lib/delivery/config';
import { validarCupom } from '@/lib/delivery/cupom';
import { normTelefone } from '@/lib/delivery/pedido';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loja = await lojaDeliveryPorSlug(slug);
  if (!loja) return NextResponse.json({ error: 'loja não encontrada' }, { status: 404 });

  const b = await request.json().catch(() => null);
  const codigo = typeof b?.codigo === 'string' ? b.codigo.trim().slice(0, 30) : '';
  const telefone = normTelefone(typeof b?.telefone === 'string' ? b.telefone : null) ?? '';
  const subtotalCentavos =
    Number.isFinite(Number(b?.subtotalCentavos)) && Number(b.subtotalCentavos) > 0
      ? Math.round(Number(b.subtotalCentavos))
      : 0;
  if (!codigo) return NextResponse.json({ ok: false, erro: 'Digite o código do cupom.' });

  const r = await validarCupom({ filialId: loja.filialId, codigo, telefone, subtotalCentavos });
  return NextResponse.json(r);
}
