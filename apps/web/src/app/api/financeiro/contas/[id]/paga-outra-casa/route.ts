// POST   /api/financeiro/contas/[id]/paga-outra-casa — conta desta casa paga
//        por OUTRA casa (fora do Inter): entra no encontro de contas do mês do
//        pagamento e, se pedido, já dá a baixa na conta (pedido do dono 20/10/2026).
// DELETE /api/financeiro/contas/[id]/paga-outra-casa?pagamentoId=uuid — desfaz
//        o lançamento enquanto o encontro do mês não fechou (a baixa, se houve,
//        se estorna à parte no histórico de pagamentos).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { RecusaTransf } from '@/lib/transferencia';
import {
  FORMAS_PAGAMENTO_CASA,
  desfazerPagamentoEntreCasas,
  lancarPagamentoManualEntreCasas,
} from '@/lib/pagamento-entre-casas';

export const dynamic = 'force-dynamic';

const Body = z.object({
  filialPagadoraId: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valor: z.number().positive(),
  forma: z.enum(FORMAS_PAGAMENTO_CASA),
  observacao: z.string().trim().max(300).nullable().optional(),
  darBaixa: z.boolean().default(true),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const r = await lancarPagamentoManualEntreCasas({ userId: user.id, contaId: id, ...parsed.data });
    return NextResponse.json({ ok: true, ...r }, { status: 201 });
  } catch (e) {
    if (e instanceof RecusaTransf) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const { id } = await ctx.params;
  const pagamentoId = new URL(req.url).searchParams.get('pagamentoId');
  if (!pagamentoId || !/^[0-9a-f-]{36}$/i.test(pagamentoId)) {
    return NextResponse.json({ error: 'pagamentoId invalido' }, { status: 400 });
  }
  // só o lançamento desta conta
  const [p] = await db
    .select({ id: schema.pagamentoEntreCasas.id })
    .from(schema.pagamentoEntreCasas)
    .where(and(eq(schema.pagamentoEntreCasas.id, pagamentoId), eq(schema.pagamentoEntreCasas.contaPagarId, id)))
    .limit(1);
  if (!p) return NextResponse.json({ error: 'lançamento não encontrado' }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, ...(await desfazerPagamentoEntreCasas(user.id, pagamentoId)) });
  } catch (e) {
    if (e instanceof RecusaTransf) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
