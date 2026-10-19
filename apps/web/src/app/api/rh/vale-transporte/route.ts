// Vale transporte quinzenal — ações da tela /rh/vale-transporte:
//   pessoa   VT da pessoa (valor do dia ida+volta, dias por semana, ativo)
//   pagar    grava a quinzena como paga (o servidor recalcula previsto e acerto;
//            da tela só vêm os dias previstos de cada um)
//            e congela o desconto de 6% da quinzena anterior (já terminada)
//   reabrir  apaga a quinzena paga — só se a seguinte ainda não foi paga,
//            senão o acerto da seguinte perde a base; o desconto da anterior
//            volta a ser lido ao vivo
// Não mexe em folha nem ponto. Desde 19/10/2026 "pagar" também gera uma conta
// a pagar por pessoa (origem FOLHA, vencimento = 1º dia da quinzena) — é com
// ela que o comprovante da lotérica casa e dá baixa; "reabrir" apaga as que
// ainda estão em aberto e recusa se alguma já foi baixada.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { montarQuinzenaVt, nomeQuinzena, quinzenaAnterior, quinzenaDe, quinzenaSeguinte, valorPagar } from '@/lib/rh/vale-transporte';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Dia = z.string().regex(/^\d{4}-\d{2}-(01|16)$/);

const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('pessoa'),
    funcionarioId: z.string().uuid(),
    ativo: z.boolean(),
    valorDia: z.number().min(0).max(500),
    diasSemana: z.number().int().min(1).max(7).nullable(),
    // 'folha' = desconta 6% do salário; 'dinheiro' = ajuda de custo, sem desconto.
    forma: z.enum(['folha', 'dinheiro']).default('folha'),
  }),
  z.object({
    acao: z.literal('pagar'),
    filialId: z.string().uuid(),
    inicio: Dia,
    dias: z.record(z.string().uuid(), z.number().int().min(0).max(16)),
  }),
  z.object({
    acao: z.literal('reabrir'),
    filialId: z.string().uuid(),
    inicio: Dia,
  }),
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'dados inválidos', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const filiais = await filiaisDoUsuario(user.id);

  if (d.acao === 'pessoa') {
    const semPerm = await negarSemPerm(user.id, 'funcionario.update');
    if (semPerm) return semPerm;
    const [func] = await db
      .select({ filialId: schema.funcionario.filialId })
      .from(schema.funcionario)
      .where(eq(schema.funcionario.id, d.funcionarioId))
      .limit(1);
    if (!func) return NextResponse.json({ error: 'funcionário não encontrado' }, { status: 404 });
    if (!filiais.some((f) => f.id === func.filialId)) {
      return NextResponse.json({ error: 'sem acesso à casa desse funcionário' }, { status: 403 });
    }
    const valores = {
      ativo: d.ativo,
      valorDia: d.valorDia.toFixed(2),
      diasSemana: d.diasSemana,
      forma: d.forma,
      atualizadoEm: new Date(),
      atualizadoPor: user.id,
    };
    await db
      .insert(schema.vtPessoa)
      .values({ funcionarioId: d.funcionarioId, ...valores })
      .onConflictDoUpdate({ target: schema.vtPessoa.funcionarioId, set: valores });
    return NextResponse.json({ ok: true });
  }

  const semPerm = await negarSemPerm(user.id, 'folha_equipe.fechar');
  if (semPerm) return semPerm;
  if (!filiais.some((f) => f.id === d.filialId)) {
    return NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 });
  }
  const q = quinzenaDe(d.inicio);

  if (d.acao === 'reabrir') {
    const seg = quinzenaSeguinte(q);
    const [pagaSeg] = await db
      .select({ id: schema.vtQuinzena.id })
      .from(schema.vtQuinzena)
      .where(and(eq(schema.vtQuinzena.filialId, d.filialId), eq(schema.vtQuinzena.dataInicio, seg.inicio)))
      .limit(1);
    if (pagaSeg) {
      return NextResponse.json({ error: 'a quinzena seguinte já foi paga; reabra ela primeiro' }, { status: 409 });
    }
    const ant = quinzenaAnterior(q);
    const contas = (
      await db
        .select({ contaId: schema.vtQuinzenaItem.contaPagarId })
        .from(schema.vtQuinzenaItem)
        .innerJoin(schema.vtQuinzena, eq(schema.vtQuinzena.id, schema.vtQuinzenaItem.quinzenaId))
        .where(
          and(
            eq(schema.vtQuinzena.filialId, d.filialId),
            eq(schema.vtQuinzena.dataInicio, q.inicio),
            isNotNull(schema.vtQuinzenaItem.contaPagarId),
          ),
        )
    ).map((r) => r.contaId!);
    if (contas.length) {
      const [baixada] = await db
        .select({ id: schema.contaPagar.id })
        .from(schema.contaPagar)
        .where(
          and(
            inArray(schema.contaPagar.id, contas),
            isNull(schema.contaPagar.dataDelete),
            isNotNull(schema.contaPagar.dataPagamento),
          ),
        )
        .limit(1);
      if (baixada) {
        return NextResponse.json(
          { error: 'já tem conta de VT dessa quinzena baixada; desfaça a baixa antes de reabrir' },
          { status: 409 },
        );
      }
    }
    await db.transaction(async (tx) => {
      if (contas.length) {
        await tx
          .update(schema.contaPagar)
          .set({ dataDelete: new Date() })
          .where(and(inArray(schema.contaPagar.id, contas), isNull(schema.contaPagar.dataPagamento)));
      }
      await tx
        .delete(schema.vtQuinzena)
        .where(and(eq(schema.vtQuinzena.filialId, d.filialId), eq(schema.vtQuinzena.dataInicio, q.inicio)));
      const [qAnt] = await tx
        .select({ id: schema.vtQuinzena.id })
        .from(schema.vtQuinzena)
        .where(and(eq(schema.vtQuinzena.filialId, d.filialId), eq(schema.vtQuinzena.dataInicio, ant.inicio)))
        .limit(1);
      if (qAnt) {
        await tx
          .update(schema.vtQuinzenaItem)
          .set({ descontoBase: null, descontoValor: null })
          .where(eq(schema.vtQuinzenaItem.quinzenaId, qAnt.id));
      }
    });
    return NextResponse.json({ ok: true });
  }

  // pagar
  const vt = await montarQuinzenaVt(d.filialId, q);
  if (vt.paga) return NextResponse.json({ error: 'quinzena já está paga' }, { status: 409 });

  const itens = vt.linhas
    .filter((l) => l.vt?.ativo && l.vt.valorDia > 0)
    .map((l) => {
      const valorDia = l.vt!.valorDia;
      const dias = d.dias[l.funcionarioId] ?? l.diasPrevistos;
      const previsto = Math.round(dias * valorDia * 100) / 100;
      const acerto = l.anterior?.saldo ?? 0;
      return {
        funcionarioId: l.funcionarioId,
        valorDia: valorDia.toFixed(2),
        diasPrevistos: dias,
        valorPrevisto: previsto.toFixed(2),
        acertoAnterior: acerto.toFixed(2),
        valorPago: valorPagar(previsto, acerto).toFixed(2),
        forma: l.vt!.forma,
      };
    });
  if (!itens.length) {
    return NextResponse.json({ error: 'ninguém com VT cadastrado nessa casa' }, { status: 400 });
  }

  // Conta a pagar por pessoa: quem recebe é o fornecedor ligado ao funcionário.
  const pessoas = await db
    .select({ id: schema.funcionario.id, nome: schema.funcionario.nome, fornecedorId: schema.funcionario.fornecedorId })
    .from(schema.funcionario)
    .where(inArray(schema.funcionario.id, itens.map((i) => i.funcionarioId)));
  const pessoaDe = new Map(pessoas.map((x) => [x.id, x]));
  const [cfg] = await db
    .select({ categoriaId: schema.folhaConfig.categoriaTransporteId })
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, d.filialId))
    .limit(1);
  const semConta = itens
    .filter((i) => Number(i.valorPago) > 0 && !pessoaDe.get(i.funcionarioId)?.fornecedorId)
    .map((i) => pessoaDe.get(i.funcionarioId)?.nome ?? i.funcionarioId);

  const total = await db.transaction(async (tx) => {
    const [criada] = await tx
      .insert(schema.vtQuinzena)
      .values({ filialId: d.filialId, dataInicio: q.inicio, dataFim: q.fim, pagaPor: user.id })
      .onConflictDoNothing()
      .returning({ id: schema.vtQuinzena.id });
    if (!criada) return null;
    const contaDe = new Map<string, string>();
    for (const i of itens) {
      const pessoa = pessoaDe.get(i.funcionarioId);
      if (Number(i.valorPago) <= 0 || !pessoa?.fornecedorId) continue;
      const [conta] = await tx
        .insert(schema.contaPagar)
        .values({
          filialId: d.filialId,
          criadoPor: user.id,
          criadoEm: new Date(),
          codigoExterno: null,
          fornecedorId: pessoa.fornecedorId,
          categoriaId: cfg?.categoriaId ?? null,
          dataVencimento: q.inicio,
          valor: i.valorPago,
          descricao: `Vale transporte ${nomeQuinzena(q)} — ${pessoa.nome}`,
          observacao: `${i.diasPrevistos} dia(s) × R$ ${i.valorDia}${Number(i.acertoAnterior) ? ` + acerto ${i.acertoAnterior}` : ''} · ${i.forma === 'dinheiro' ? 'ajuda de custo' : 'VT na folha'}`,
          competencia: q.inicio.slice(0, 7),
          origem: 'FOLHA',
          folhaSemanaId: null,
        })
        .returning({ id: schema.contaPagar.id });
      contaDe.set(i.funcionarioId, conta!.id);
    }
    await tx
      .insert(schema.vtQuinzenaItem)
      .values(itens.map((i) => ({ ...i, quinzenaId: criada.id, contaPagarId: contaDe.get(i.funcionarioId) ?? null })));
    // A anterior já terminou: o desconto de 6% dela fica gravado.
    const [qAnt] = await tx
      .select({ id: schema.vtQuinzena.id })
      .from(schema.vtQuinzena)
      .where(and(eq(schema.vtQuinzena.filialId, d.filialId), eq(schema.vtQuinzena.dataInicio, vt.anterior.inicio)))
      .limit(1);
    if (qAnt) {
      for (const l of vt.linhas) {
        if (!l.anterior) continue;
        await tx
          .update(schema.vtQuinzenaItem)
          .set({
            descontoBase: (l.anterior.baseDesconto?.valor ?? 0).toFixed(2),
            descontoValor: l.anterior.desconto.toFixed(2),
          })
          .where(
            and(
              eq(schema.vtQuinzenaItem.quinzenaId, qAnt.id),
              eq(schema.vtQuinzenaItem.funcionarioId, l.funcionarioId),
              isNull(schema.vtQuinzenaItem.descontoValor),
            ),
          );
      }
    }
    return itens.reduce((s, i) => s + Number(i.valorPago), 0);
  });
  if (total === null) return NextResponse.json({ error: 'quinzena já está paga' }, { status: 409 });
  return NextResponse.json({ ok: true, pessoas: itens.length, total, semConta });
}
