// POST /api/lelis/pedido/[id]/receber — a casa confere o pedido sem nota da
// Lelis e dá entrada no estoque dela (06/11/2026: "cada casa confere e dá
// entrada"). Body: { observacao?, itens: [{ itemId, quantidadeRecebida, produtoCasaId|null,
// produtoOutraCasaId?, cadastrar? }] }
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { receberPedidoLelis, RecusaPedido } from '@/lib/lelis/pedido';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  observacao: z.string().trim().max(500).nullable().optional(),
  itens: z
    .array(z.object({
      itemId: z.string().uuid(),
      quantidadeRecebida: z.number().min(0),
      produtoCasaId: z.string().uuid().nullable(),
      // a casa não tem o vinho: traz o cadastro da outra casa, ou cadastra (11/11/2026)
      produtoOutraCasaId: z.string().uuid().nullable().optional(),
      cadastrar: z.boolean().optional(),
    }))
    .min(1)
    .max(300),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('nota_compra.lancar_estoque');
  if (error) return error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });

  const [ped] = (await db.execute(
    sql`SELECT destino_filial_id AS destino FROM revenda_pedido WHERE id = ${id}::uuid`,
  )) as unknown as { destino: string }[];
  const filiais = await filiaisDoUsuario(user.id);
  if (!ped || !filiais.some((f) => f.id === ped.destino)) {
    return NextResponse.json({ error: 'sem acesso a esta casa' }, { status: 403 });
  }
  try {
    const r = await receberPedidoLelis({
      pedidoId: id,
      casaId: ped.destino,
      itens: p.data.itens,
      observacao: p.data.observacao,
      userId: user.id,
      email: user.email ?? user.id,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof RecusaPedido) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
