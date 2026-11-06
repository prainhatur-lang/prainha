// /api/lelis/pedido — pedido SEM NOTA da Lelis pras casas (06/11/2026).
// GET: lista. POST: cria (baixa estoque + a receber + conta a pagar na casa).
// DELETE ?id=: cancela (só se a casa não pagou e a Lelis não recebeu).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { acessoLelisApi } from '@/lib/lelis/acesso';
import { cancelarPedidoLelis, criarPedidoLelis, listarPedidosLelis, RecusaPedido } from '@/lib/lelis/pedido';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  return NextResponse.json({ pedidos: await listarPedidosLelis(a.filialId) });
}

const Body = z.object({
  destinoId: z.string().uuid(),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observacao: z.string().max(500).optional().nullable(),
  itens: z
    .array(z.object({ produtoId: z.string().uuid(), quantidade: z.number().positive(), precoUnit: z.number().positive() }))
    .min(1)
    .max(200),
});

export async function POST(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  try {
    const r = await criarPedidoLelis({ ...p.data, lelisId: a.filialId, userId: a.userId, email: a.email });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof RecusaPedido) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  try {
    await cancelarPedidoLelis({ lelisId: a.filialId, pedidoId: id, email: a.email });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RecusaPedido) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
