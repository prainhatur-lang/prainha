// POST /api/financeiro/contas/[id]/valor-boleto — conta de NF-e cujo boleto
// veio com valor diferente da nota (acréscimo financeiro, tarifa bancária
// embutida no boleto). O valor da conta passa a ser o do boleto — é o que sai
// do banco e é por ele que o boleto pago no Inter casa com a conta — e
// `valor_nota` guarda o que a nota mandou (fica na primeira vez). A duplicata
// da nota (nota_compra_duplicata) não muda: é o que está no XML.
//
// Só origem='NFE'. O PATCH da conta MANUAL continua igual em ../route.ts.

import { NextResponse } from 'next/server';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';

const Body = z.object({
  valor: z.number().positive(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('conta_pagar.update');
  if (error) return error;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'valor invalido' }, { status: 400 });
  }
  const novo = Math.round(parsed.data.valor * 100) / 100;

  const [conta] = await db
    .select({
      id: schema.contaPagar.id,
      filialId: schema.contaPagar.filialId,
      origem: schema.contaPagar.origem,
      valor: schema.contaPagar.valor,
      valorNota: schema.contaPagar.valorNota,
      dataDelete: schema.contaPagar.dataDelete,
    })
    .from(schema.contaPagar)
    .where(eq(schema.contaPagar.id, id))
    .limit(1);
  if (!conta || conta.dataDelete) {
    return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 });
  }
  if (conta.origem !== 'NFE') {
    return NextResponse.json({ error: 'só conta nascida de nota fiscal' }, { status: 400 });
  }
  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, conta.filialId),
      ),
    )
    .limit(1);
  if (!acesso && !(await ebLiberadaNoFinanceiro(user.id, conta.filialId))) return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });

  const valorNota = Number(conta.valorNota ?? conta.valor);
  // Boleto não costuma ficar longe da nota: trava erro de digitação grosseiro
  if (Math.abs(novo - valorNota) > Math.max(50, valorNota * 0.1)) {
    return NextResponse.json(
      { error: `diferença grande demais pra nota de R$ ${valorNota.toFixed(2)} — confira o valor digitado` },
      { status: 400 },
    );
  }

  // Igual ao PATCH: não fica menor que o já pago e recalcula se está quitada
  const baixas = await db
    .select({
      data: schema.contaPagarBaixa.data,
      valor: schema.contaPagarBaixa.valor,
      juros: schema.contaPagarBaixa.juros,
    })
    .from(schema.contaPagarBaixa)
    .where(eq(schema.contaPagarBaixa.contaPagarId, id))
    .orderBy(asc(schema.contaPagarBaixa.data));
  const pago = baixas.reduce((s, x) => s + Number(x.valor), 0);
  const jurosPagos = baixas.reduce((s, x) => s + Number(x.juros ?? 0), 0);
  if (novo < pago - 0.005) {
    return NextResponse.json(
      { error: `valor menor que o principal já pago (R$ ${pago.toFixed(2)}) — estorne baixas antes` },
      { status: 400 },
    );
  }
  const quitada = pago >= novo - 0.005 && baixas.length > 0;
  const voltouProDaNota = Math.abs(novo - valorNota) < 0.005;

  await db
    .update(schema.contaPagar)
    .set({
      valor: novo.toFixed(2),
      // voltou pro valor da nota = desfaz o ajuste
      valorNota: voltouProDaNota ? null : valorNota.toFixed(2),
      ...(baixas.length > 0
        ? {
            valorPago: (pago + jurosPagos).toFixed(2),
            jurosMulta: jurosPagos > 0 ? jurosPagos.toFixed(2) : null,
            dataPagamento: quitada ? baixas[baixas.length - 1]!.data : null,
          }
        : {}),
    })
    .where(eq(schema.contaPagar.id, id));

  return NextResponse.json({ ok: true, valor: novo, valorNota, acrescimo: novo - valorNota });
}
