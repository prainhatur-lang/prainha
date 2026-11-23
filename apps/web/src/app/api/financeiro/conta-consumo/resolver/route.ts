// POST /api/financeiro/conta-consumo/resolver — desfecho manual de um
// pagamento que ficou ENVIANDO (o Inter não respondeu e a consulta não acha):
// quem conferiu no app do Inter diz se o dinheiro saiu ou não. Só o Admin.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { podePagarPix } from '@/lib/pix-pagamento';
import { baixarContaConsumo } from '@/lib/conta-consumo-pagamento';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

const Body = z.object({
  id: z.string().uuid(),
  acao: z.enum(['saiu', 'nao_saiu']),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  if (!(await podePagarPix(user.id))) return NextResponse.json({ error: 'Só o Admin.' }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const { id, acao } = parsed.data;
  const [p] = await db
    .select({ id: schema.contaConsumoPagamento.id, filialId: schema.contaConsumoPagamento.filialId, status: schema.contaConsumoPagamento.status })
    .from(schema.contaConsumoPagamento)
    .where(eq(schema.contaConsumoPagamento.id, id))
    .limit(1);
  if (!p) return NextResponse.json({ error: 'não achei' }, { status: 404 });
  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, p.filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });
  if (!['ENVIANDO', 'APROVACAO', 'AGENDADO'].includes(p.status)) {
    return NextResponse.json({ error: `Já está ${p.status}.` }, { status: 409 });
  }
  const quem = user.email ?? user.id;
  if (acao === 'saiu') {
    const data = parsed.data.data ?? hojeBr();
    if (data > hojeBr()) return NextResponse.json({ error: 'Data no futuro.' }, { status: 400 });
    await db
      .update(schema.contaConsumoPagamento)
      .set({ erro: `Confirmado à mão por ${quem}: saiu no Inter`, atualizadoEm: new Date() })
      .where(eq(schema.contaConsumoPagamento.id, id));
    const { baixada } = await baixarContaConsumo(id, data);
    return NextResponse.json({ ok: true, baixada });
  }
  await db
    .update(schema.contaConsumoPagamento)
    .set({ status: 'ERRO', erro: `Confirmado à mão por ${quem}: NÃO saiu no Inter`, atualizadoEm: new Date() })
    .where(and(eq(schema.contaConsumoPagamento.id, id), isNull(schema.contaConsumoPagamento.baixadoEm), sql`status IN ('ENVIANDO','APROVACAO','AGENDADO')`));
  return NextResponse.json({ ok: true });
}
