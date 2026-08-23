// PATCH /api/financeiro/receber-canal/[id] — baixa ou cancela um lançamento
// de conta a receber de canal (iFood etc.).
//
// acao='receber': o repasse caiu (conferido contra o extrato/relatório do
//   canal) — grava o valor LÍQUIDO que entrou de verdade, não o bruto do
//   pedido (a diferença é a comissão do canal).
// acao='cancelar': não era pra receber aqui — pedido pago na entrega por
//   engano, ou duplicado. Fica registrado, não desaparece (auditoria).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('receber'),
    valorRecebido: z.number().positive(),
    dataRecebimento: z.string().regex(YMD).optional(),
    observacao: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({
    acao: z.literal('cancelar'),
    observacao: z.string().trim().min(2, 'diga o motivo').max(500),
  }),
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conta_receber.update');
  if (error) return error;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body inválido', details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  const [lanc] = await db
    .select({ id: schema.contaReceberCanal.id, filialId: schema.contaReceberCanal.filialId, status: schema.contaReceberCanal.status })
    .from(schema.contaReceberCanal)
    .where(eq(schema.contaReceberCanal.id, id))
    .limit(1);
  if (!lanc) return NextResponse.json({ error: 'lançamento não encontrado' }, { status: 404 });
  if (lanc.status !== 'aberto') {
    return NextResponse.json({ error: `já está ${lanc.status} — não dá pra mexer de novo` }, { status: 400 });
  }

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, lanc.filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso a essa filial' }, { status: 403 });

  if (b.acao === 'receber') {
    await db
      .update(schema.contaReceberCanal)
      .set({
        status: 'recebido',
        valorRecebido: String(b.valorRecebido),
        dataRecebimento: b.dataRecebimento ?? hojeBr(),
        observacao: b.observacao ?? null,
        recebidoPor: user.id,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.contaReceberCanal.id, id));
  } else {
    await db
      .update(schema.contaReceberCanal)
      .set({ status: 'cancelado', observacao: b.observacao, recebidoPor: user.id, atualizadoEm: new Date() })
      .where(eq(schema.contaReceberCanal.id, id));
  }
  return NextResponse.json({ ok: true });
}
