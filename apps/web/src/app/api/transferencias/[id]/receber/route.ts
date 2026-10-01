// POST /api/transferencias/[id]/receber — a casa que RECEBE confere a
// mercadoria de uma transferência em trânsito (ENVIADA): dá entrada no
// estoque dela, gera a conta a pagar pelo que chegou e devolve a diferença
// pra origem. Body: { data?, observacao?, itens?: [{ itemId, quantidadeRecebida }] }
// (item fora da lista = recebeu o que foi enviado).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { hojeBr } from '@/lib/datas';
import { receberTransferencia, RecusaTransf } from '@/lib/transferencia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  observacao: z.string().trim().max(500).nullable().optional(),
  itens: z
    .array(z.object({ itemId: z.string().uuid(), quantidadeRecebida: z.number().min(0) }))
    .max(300)
    .optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('nota_compra.lancar_estoque');
  if (error) return error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const r = await receberTransferencia({
      id,
      userId: user.id,
      data: parsed.data.data ?? hojeBr(),
      itens: parsed.data.itens,
      observacao: parsed.data.observacao,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof RecusaTransf) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
