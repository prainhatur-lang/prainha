// POST /api/transferencias — transfere mercadoria de uma casa pra outra.
// Body: { filialOrigemId, filialDestinoId, data?, notaCompraId?, observacao?,
//         entradaImediata? (true = entra no destino na hora; false = fica em
//         trânsito até a casa que recebe conferir),
//         itens: [{ produtoOrigemId, produtoDestinoId (null = cadastra no destino), quantidade, custoUnitario? }] }
// Regra em @/lib/transferencia (custo médio da origem; conta a pagar no destino).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { hojeBr } from '@/lib/datas';
import { criarTransferencia, RecusaTransf } from '@/lib/transferencia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  filialOrigemId: z.string().uuid(),
  filialDestinoId: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notaCompraId: z.string().uuid().nullable().optional(),
  observacao: z.string().trim().max(500).nullable().optional(),
  entradaImediata: z.boolean().optional(),
  itens: z
    .array(
      z.object({
        produtoOrigemId: z.string().uuid(),
        produtoDestinoId: z.string().uuid().nullable(),
        quantidade: z.number().positive(),
        custoUnitario: z.number().positive().optional(),
      }),
    )
    .min(1)
    .max(300),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('nota_compra.lancar_estoque');
  if (error) return error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const r = await criarTransferencia({ userId: user.id, ...parsed.data, data: parsed.data.data ?? hojeBr() });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof RecusaTransf) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
