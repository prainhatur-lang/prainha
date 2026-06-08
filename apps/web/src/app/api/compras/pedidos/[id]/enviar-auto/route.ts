// POST /api/compras/pedidos/[id]/enviar-auto
// Envia o pedido de compra AUTOMATICAMENTE pro fornecedor via WhatsApp
// (template UTILIDADE WHATSAPP_PEDIDO_TEMPLATE). Marca como ENVIADO.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { enviarPedidoAuto } from '@/lib/enviar-pedido';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'pedido_compra.enviar');
  if (semPerm) return semPerm;

  const { id } = await params;
  const r = await enviarPedidoAuto(id);
  if (!r.ok) {
    // "não configurado" / "sem telefone" são erros do cliente (400); resto 502.
    const status = /configurado|telefone|cancelado|não encontrado/i.test(r.error ?? '') ? 400 : 502;
    return NextResponse.json({ error: r.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
