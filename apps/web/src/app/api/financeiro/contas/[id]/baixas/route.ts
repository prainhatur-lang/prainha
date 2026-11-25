// POST   /api/financeiro/contas/[id]/baixas — registra pagamento (parcial ou total)
// DELETE /api/financeiro/contas/[id]/baixas?baixaId=uuid — estorna uma baixa
//
// Regras:
//  - só contas nascidas na nuvem (origem != CONSUMER): as do PDV são pagas no
//    Consumer e o sync sobrescreveria o agregado aqui.
//    Exceção (14/10/2026): casa que parou de mandar conta do Consumer
//    (lib/consumer-contas) baixa a conta CONSUMER aqui — a não ser que o
//    próprio Consumer já tenha marcado paga. O sync não mexe mais no
//    pagamento de conta que tem baixa daqui (concilia-mappers).
//  - agregado recalculado a cada mudança: valor_pago = soma das baixas;
//    data_pagamento = data da última baixa quando soma >= valor (quitada),
//    NULL enquanto houver saldo (parcial fica "em aberto" nos filtros).

import { NextResponse } from 'next/server';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { consumerParado } from '@/lib/consumer-contas';
import { travaMesmaDivida } from '@/lib/conta-mesma-divida';
import { recalcularAgregado } from '@/lib/conta-pagar-baixa';
import { lerMotivo, registrarExclusao } from '@/lib/registro-exclusao';
import { estornarPagamentoDoPortador, lancarPagamentoDoPortador, portadorAtivoDaCasa } from '@/lib/portador';

export const dynamic = 'force-dynamic';

const Body = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** principal amortizado — abate o saldo; a conta quita quando o principal
   *  cobre o valor original */
  valor: z.number().min(0), // 0 = só desconto (abatimento sem dinheiro)
  /** juros/multa pagos junto (atraso) — vão por fora do saldo */
  juros: z.number().min(0).optional(),
  /** desconto obtido (26/10/2026) — abate o saldo junto com `valor`, mas não
   *  sai do caixa. Na baixa grava valor = valor + desconto (principal). */
  desconto: z.number().min(0).optional(),
  observacao: z.string().trim().max(500).nullable().optional(),
  /** Pago em DINHEIRO (25/11/2026): de qual portador saiu (Cofre, Elison…).
   *  Lança a saída nele junto com a baixa. Ausente = saiu do banco. */
  portadorId: z.string().uuid().nullable().optional(),
  /** pago pelo banco: de qual conta saiu (Inter, Sicredi, cartão…) — vai na observação */
  bancoOrigem: z.string().trim().max(60).nullable().optional(),
});

async function carregarConta(id: string, userId: string) {
  const [conta] = await db
    .select({
      id: schema.contaPagar.id,
      filialId: schema.contaPagar.filialId,
      valor: schema.contaPagar.valor,
      origem: schema.contaPagar.origem,
      dataPagamento: schema.contaPagar.dataPagamento,
      dataDelete: schema.contaPagar.dataDelete,
    })
    .from(schema.contaPagar)
    .where(eq(schema.contaPagar.id, id))
    .limit(1);
  if (!conta || conta.dataDelete) return { erro: NextResponse.json({ error: 'conta não encontrada' }, { status: 404 }) };
  if (conta.origem === 'CONSUMER' && (await consumerParado(conta.filialId))) {
    // Consumer da casa parado: baixa aqui, menos se o Consumer já pagou
    const [daqui] = await db
      .select({ id: schema.contaPagarBaixa.id })
      .from(schema.contaPagarBaixa)
      .where(eq(schema.contaPagarBaixa.contaPagarId, conta.id))
      .limit(1);
    if (conta.dataPagamento && !daqui) {
      return {
        erro: NextResponse.json({ error: 'conta já paga no PDV da loja' }, { status: 400 }),
      };
    }
  } else if (conta.origem === 'CONSUMER') {
    return {
      erro: NextResponse.json(
        { error: 'conta do PDV: a baixa é feita no PDV da loja e sincroniza sozinha' },
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
  if (!acesso && !(await ebLiberadaNoFinanceiro(userId, conta.filialId))) return { erro: NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 }) };
  return { conta };
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

  // Mesma dívida (23/11/2026): conta VINCULADA a outra já paga (boleto × Pix)
  // não leva segunda baixa. Só a parecida (sem vínculo) não trava aqui.
  const dobro = await travaMesmaDivida([id]).catch(() => null);
  if (dobro?.tipo === 'vinculada') return NextResponse.json({ error: dobro.msg }, { status: 409 });

  const valorConta = Number(conta.valor);
  const jaPago = (
    await db
      .select({ valor: schema.contaPagarBaixa.valor })
      .from(schema.contaPagarBaixa)
      .where(eq(schema.contaPagarBaixa.contaPagarId, id))
  ).reduce((s, x) => s + Number(x.valor), 0);
  const saldo = valorConta - jaPago;
  const desconto = parsed.data.desconto && parsed.data.desconto > 0 ? parsed.data.desconto : 0;
  const principal = parsed.data.valor + desconto;
  if (principal <= 0) {
    return NextResponse.json({ error: 'valor ou desconto tem que ser maior que zero' }, { status: 400 });
  }
  if (principal > saldo + 0.005) {
    if (desconto > 0) {
      return NextResponse.json(
        { error: `valor + desconto maior que o saldo em aberto (R$ ${saldo.toFixed(2)})` },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: `valor maior que o saldo em aberto (R$ ${saldo.toFixed(2)})` },
      { status: 400 },
    );
  }

  const portador = parsed.data.portadorId ? await portadorAtivoDaCasa(conta.filialId, parsed.data.portadorId) : null;
  if (parsed.data.portadorId && !portador) {
    return NextResponse.json({ error: 'portador do dinheiro não encontrado nesta casa' }, { status: 400 });
  }
  const obsDinheiro = portador
    ? `Dinheiro · ${portador.nome}`
    : parsed.data.bancoOrigem
      ? `Banco · ${parsed.data.bancoOrigem}`
      : null;

  const [baixa] = await db.insert(schema.contaPagarBaixa).values({
    filialId: conta.filialId,
    contaPagarId: id,
    data: parsed.data.data,
    valor: principal.toFixed(2),
    juros: parsed.data.juros && parsed.data.juros > 0 ? parsed.data.juros.toFixed(2) : null,
    desconto: desconto > 0 ? desconto.toFixed(2) : null,
    observacao: [obsDinheiro, parsed.data.observacao].filter(Boolean).join(' — ') || null,
    criadoPor: user.id,
  }).returning({ id: schema.contaPagarBaixa.id });

  if (portador && baixa) {
    await lancarPagamentoDoPortador({
      filialId: conta.filialId,
      portadorId: portador.id,
      baixaId: baixa.id,
      contaId: id,
      data: parsed.data.data,
      valor: parsed.data.valor + (parsed.data.juros ?? 0),
      userId: user.id,
    });
  }

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

  // Registro de quem estornou (20/10/2026) — antes de apagar; se falhar, não apaga.
  const [baixaFoto] = await db
    .select()
    .from(schema.contaPagarBaixa)
    .where(and(eq(schema.contaPagarBaixa.id, baixaId), eq(schema.contaPagarBaixa.contaPagarId, id)))
    .limit(1);
  if (baixaFoto) {
    try {
      await registrarExclusao({
        tabela: 'conta_pagar_baixa',
        registroId: baixaId,
        filialId: baixaFoto.filialId,
        usuarioId: user.id,
        motivo: await lerMotivo(req),
        resumo: `estorno do pagamento de ${baixaFoto.data.split('-').reverse().join('/')} · R$ ${Number(baixaFoto.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · conta ${id}`,
        dados: baixaFoto,
      });
    } catch (e) {
      return NextResponse.json(
        { error: `não consegui registrar o estorno, nada foi apagado (${(e as Error).message})` },
        { status: 500 },
      );
    }
  }

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
  // baixa em dinheiro: o dinheiro volta pro portador
  await estornarPagamentoDoPortador(conta.filialId, baixaId, user.id);

  const agregado = await recalcularAgregado(id, Number(conta.valor));
  return NextResponse.json({ ok: true, ...agregado });
}
