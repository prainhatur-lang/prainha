// POST   /api/financeiro/contas/[id]/baixas — registra pagamento (parcial ou total)
// DELETE /api/financeiro/contas/[id]/baixas?baixaId=uuid — estorna uma baixa
//
// Regras:
//  - só contas nascidas na nuvem (origem != CONSUMER): as do PDV são pagas no
//    Consumer e o sync sobrescreveria o agregado aqui.
//  - agregado recalculado a cada mudança: valor_pago = soma das baixas;
//    data_pagamento = data da última baixa quando soma >= valor (quitada),
//    NULL enquanto houver saldo (parcial fica "em aberto" nos filtros).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';

const Body = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valor: z.number().positive(),
  observacao: z.string().trim().max(500).nullable().optional(),
});

async function carregarConta(id: string, userId: string) {
  const [conta] = await db
    .select({
      id: schema.contaPagar.id,
      filialId: schema.contaPagar.filialId,
      valor: schema.contaPagar.valor,
      origem: schema.contaPagar.origem,
      dataDelete: schema.contaPagar.dataDelete,
    })
    .from(schema.contaPagar)
    .where(eq(schema.contaPagar.id, id))
    .limit(1);
  if (!conta || conta.dataDelete) return { erro: NextResponse.json({ error: 'conta não encontrada' }, { status: 404 }) };
  if (conta.origem === 'CONSUMER') {
    return {
      erro: NextResponse.json(
        { error: 'conta do Consumer: a baixa é feita no PDV e sincroniza sozinha' },
        { status: 400 },
      ),
    };
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

/** Recalcula valor_pago/data_pagamento a partir das baixas. */
async function recalcularAgregado(contaId: string, valorConta: number) {
  const baixas = await db
    .select({ data: schema.contaPagarBaixa.data, valor: schema.contaPagarBaixa.valor })
    .from(schema.contaPagarBaixa)
    .where(eq(schema.contaPagarBaixa.contaPagarId, contaId))
    .orderBy(asc(schema.contaPagarBaixa.data));
  const total = baixas.reduce((s, x) => s + Number(x.valor), 0);
  const quitada = total >= valorConta - 0.005;
  await db
    .update(schema.contaPagar)
    .set({
      valorPago: total > 0 ? total.toFixed(2) : null,
      dataPagamento: quitada && baixas.length > 0 ? baixas[baixas.length - 1]!.data : null,
    })
    .where(eq(schema.contaPagar.id, contaId));
  return { total, quitada };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const { id } = await ctx.params;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const r = await carregarConta(id, user.id);
  if (r.erro) return r.erro;
  const conta = r.conta!;

  const valorConta = Number(conta.valor);
  const jaPago = (
    await db
      .select({ valor: schema.contaPagarBaixa.valor })
      .from(schema.contaPagarBaixa)
      .where(eq(schema.contaPagarBaixa.contaPagarId, id))
  ).reduce((s, x) => s + Number(x.valor), 0);
  const saldo = valorConta - jaPago;
  if (parsed.data.valor > saldo + 0.005) {
    return NextResponse.json(
      { error: `valor maior que o saldo em aberto (R$ ${saldo.toFixed(2)})` },
      { status: 400 },
    );
  }

  await db.insert(schema.contaPagarBaixa).values({
    filialId: conta.filialId,
    contaPagarId: id,
    data: parsed.data.data,
    valor: parsed.data.valor.toFixed(2),
    observacao: parsed.data.observacao ?? null,
    criadoPor: user.id,
  });

  const agregado = await recalcularAgregado(id, valorConta);
  return NextResponse.json({ ok: true, ...agregado }, { status: 201 });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  const { id } = await ctx.params;

  const baixaId = new URL(req.url).searchParams.get('baixaId');
  if (!baixaId || !/^[0-9a-f-]{36}$/i.test(baixaId)) {
    return NextResponse.json({ error: 'baixaId invalido' }, { status: 400 });
  }

  const r = await carregarConta(id, user.id);
  if (r.erro) return r.erro;
  const conta = r.conta!;

  const apagadas = await db
    .delete(schema.contaPagarBaixa)
    .where(
      and(
        eq(schema.contaPagarBaixa.id, baixaId),
        eq(schema.contaPagarBaixa.contaPagarId, id),
      ),
    )
    .returning({ id: schema.contaPagarBaixa.id });
  if (apagadas.length === 0) {
    return NextResponse.json({ error: 'baixa não encontrada' }, { status: 404 });
  }

  const agregado = await recalcularAgregado(id, Number(conta.valor));
  return NextResponse.json({ ok: true, ...agregado });
}
