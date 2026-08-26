// PATCH  /api/financeiro/contas/[id] — altera uma conta a pagar MANUAL
// DELETE /api/financeiro/contas/[id] — exclui (soft delete) uma conta MANUAL
//
// Só origem='MANUAL': conta do Consumer o sync sobrescreveria (altera no PDV),
// a da folha é snapshot imutável (reabre a folha), a de NFe se gerencia pela
// nota de origem. O status (paga/parcial) NÃO se edita aqui — vem das baixas;
// mudar o valor recalcula se a conta está quitada.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.object({
  descricao: z.string().trim().min(2).max(500),
  valor: z.number().positive(),
  dataVencimento: z.string().regex(YMD),
  dataLancamento: z.string().regex(YMD).optional(),
  fornecedorId: z.string().uuid().nullable().optional(),
  categoriaId: z.string().uuid().nullable().optional(),
  observacao: z.string().trim().max(1000).nullable().optional(),
});

async function carregarContaManual(id: string, userId: string) {
  const [conta] = await db
    .select({
      id: schema.contaPagar.id,
      filialId: schema.contaPagar.filialId,
      origem: schema.contaPagar.origem,
      dataDelete: schema.contaPagar.dataDelete,
    })
    .from(schema.contaPagar)
    .where(eq(schema.contaPagar.id, id))
    .limit(1);
  if (!conta || conta.dataDelete) {
    return { erro: NextResponse.json({ error: 'conta não encontrada' }, { status: 404 }) };
  }
  if (conta.origem !== 'MANUAL') {
    const motivo =
      conta.origem === 'CONSUMER'
        ? 'conta do Consumer: altere no PDV da loja (o sync sobrescreveria)'
        : conta.origem === 'FOLHA'
          ? 'conta gerada pelo fechamento da folha: reabra a folha pra mexer'
          : 'conta nascida de nota fiscal: gerencie pela nota de origem';
    return { erro: NextResponse.json({ error: motivo }, { status: 400 }) };
  }
  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        eq(schema.usuarioFilial.filialId, conta.filialId),
      ),
    )
    .limit(1);
  if (!acesso) return { erro: NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 }) };
  return { conta };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conta_pagar.update');
  if (error) return error;
  const { id } = await ctx.params;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const b = parsed.data;

  const r = await carregarContaManual(id, user.id);
  if (r.erro) return r.erro;
  const conta = r.conta!;

  if (b.categoriaId) {
    const [cat] = await db
      .select({ id: schema.categoriaConta.id })
      .from(schema.categoriaConta)
      .where(
        and(eq(schema.categoriaConta.id, b.categoriaId), eq(schema.categoriaConta.filialId, conta.filialId)),
      )
      .limit(1);
    if (!cat) return NextResponse.json({ error: 'categoria não é da filial' }, { status: 400 });
  }
  if (b.fornecedorId) {
    const [forn] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(and(eq(schema.fornecedor.id, b.fornecedorId), eq(schema.fornecedor.filialId, conta.filialId)))
      .limit(1);
    if (!forn) return NextResponse.json({ error: 'fornecedor não é da filial' }, { status: 400 });
  }

  // Valor não pode ficar menor que o já pago (senão o histórico vira mentira)
  const baixas = await db
    .select({ data: schema.contaPagarBaixa.data, valor: schema.contaPagarBaixa.valor })
    .from(schema.contaPagarBaixa)
    .where(eq(schema.contaPagarBaixa.contaPagarId, id))
    .orderBy(asc(schema.contaPagarBaixa.data));
  const pago = baixas.reduce((s, x) => s + Number(x.valor), 0);
  if (b.valor < pago - 0.005) {
    return NextResponse.json(
      { error: `valor menor que o já pago (R$ ${pago.toFixed(2)}) — estorne baixas antes` },
      { status: 400 },
    );
  }
  const quitada = pago >= b.valor - 0.005 && baixas.length > 0;

  await db
    .update(schema.contaPagar)
    .set({
      descricao: b.descricao,
      valor: b.valor.toFixed(2),
      dataVencimento: b.dataVencimento,
      competencia: b.dataVencimento.slice(0, 7),
      fornecedorId: b.fornecedorId ?? null,
      categoriaId: b.categoriaId ?? null,
      observacao: b.observacao ?? null,
      ...(b.dataLancamento
        ? { dataCadastro: new Date(`${b.dataLancamento}T12:00:00-03:00`) }
        : {}),
      valorPago: pago > 0 ? pago.toFixed(2) : null,
      dataPagamento: quitada ? baixas[baixas.length - 1]!.data : null,
    })
    .where(eq(schema.contaPagar.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conta_pagar.delete');
  if (error) return error;
  const { id } = await ctx.params;

  const r = await carregarContaManual(id, user.id);
  if (r.erro) return r.erro;

  // Soft delete — a linha (e o histórico de baixas) fica pra auditoria,
  // mas some das listas, dos totais e do DRE.
  await db
    .update(schema.contaPagar)
    .set({ dataDelete: new Date() })
    .where(eq(schema.contaPagar.id, id));

  return NextResponse.json({ ok: true });
}
