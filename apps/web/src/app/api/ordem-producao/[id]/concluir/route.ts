// POST /api/ordem-producao/[id]/concluir
// Fecha a OP: calcula rateio proporcional entre saídas PRODUTO,
// grava movimento_estoque (SAIDA_PRODUCAO nas entradas + ENTRADA_PRODUCAO
// nas saídas PRODUTO), atualiza produto.estoqueAtual, seta status=CONCLUIDA.
//
// Rateio por UNIDADES-PESO (qtd × pesoRelativo):
//  - C = soma dos valor_total das entradas (cada entrada já tem preco_unitario;
//    se entrada.preco for null, usa produto.preco_custo; se também null, 0).
//  - U = sum(qtd × pesoRelativo) das saídas tipo=PRODUTO. Perdas excluídas
//    do denominador → seu custo é AUTOMATICAMENTE absorvido pelos cortes úteis.
//  - custo por unidade-peso = C / U
//  - custo unit do corte = pesoRelativo × custo_por_unidade_peso
//  - Cortes nobres (peso>1) absorvem proporcionalmente mais; populares
//    (peso<1) absorvem menos.
//  - Se U = 0, todas as saídas são perda — grava custo 0 e segue.
//  - Se todas as saídas têm pesoRelativo=1 (default), o resultado equivale
//    ao rateio puro por quantidade.
//
// Idempotente-ish: retorna 400 se OP já estiver CONCLUIDA.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { aplicarMpmEntrada, aplicarSaida } from '@/lib/custo-medio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [op] = await db
    .select()
    .from(schema.ordemProducao)
    .where(eq(schema.ordemProducao.id, id))
    .limit(1);
  if (!op) return NextResponse.json({ error: 'OP nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, op.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  if (op.status !== 'RASCUNHO') {
    return NextResponse.json(
      { error: `OP ${op.status} nao pode ser concluida` },
      { status: 400 },
    );
  }

  const entradas = await db
    .select({
      id: schema.ordemProducaoEntrada.id,
      produtoId: schema.ordemProducaoEntrada.produtoId,
      quantidade: schema.ordemProducaoEntrada.quantidade,
      precoUnitario: schema.ordemProducaoEntrada.precoUnitario,
      valorTotal: schema.ordemProducaoEntrada.valorTotal,
      produtoPrecoCusto: schema.produto.precoCusto,
    })
    .from(schema.ordemProducaoEntrada)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.ordemProducaoEntrada.produtoId))
    .where(eq(schema.ordemProducaoEntrada.ordemProducaoId, id));

  if (entradas.length === 0) {
    return NextResponse.json(
      { error: 'adicione pelo menos uma entrada antes de concluir' },
      { status: 400 },
    );
  }

  const saidas = await db
    .select()
    .from(schema.ordemProducaoSaida)
    .where(eq(schema.ordemProducaoSaida.ordemProducaoId, id));

  if (saidas.length === 0) {
    return NextResponse.json(
      { error: 'adicione pelo menos uma saida antes de concluir' },
      { status: 400 },
    );
  }

  // 1) Custo total das entradas. Prioridade do preço unitário:
  //    1º) preco_unitario da própria linha de entrada (se user editou)
  //    2º) produto.preco_custo CORRENTE (custo médio do estoque atual)
  //    3º) 0
  //
  //    A escolha 2 garante que a OP consume o filé pelo CUSTO REAL DO
  //    ESTOQUE no momento da conclusão (que é o MPM atualizado pela última
  //    NFe + frete rateado), não o "último custo de compra".
  let custoTotal = 0;
  const qtdTotalEntradas = entradas.reduce((s, e) => s + Number(e.quantidade ?? 0), 0);

  for (const e of entradas) {
    const qtd = Number(e.quantidade ?? 0);
    const preco =
      e.precoUnitario !== null
        ? Number(e.precoUnitario)
        : Number(e.produtoPrecoCusto ?? 0);
    custoTotal += qtd * preco;
  }

  // 2) Rateio por UNIDADES-PESO das saidas PRODUTO. Perdas absorvem custo
  //    automaticamente (não entram no denominador). Cortes nobres (peso>1)
  //    absorvem mais; populares (peso<1) absorvem menos.
  const saidasUteis = saidas.filter((s) => s.tipo === 'PRODUTO');
  const unidadesPesoUtil = saidasUteis.reduce(
    (s, r) => s + Number(r.quantidade ?? 0) * Number(r.pesoRelativo ?? 1),
    0,
  );
  const qtdTotalSaidas = saidas.reduce((s, r) => s + Number(r.quantidade ?? 0), 0);

  const divergenciaPerc =
    qtdTotalEntradas > 0
      ? ((qtdTotalEntradas - qtdTotalSaidas) / qtdTotalEntradas) * 100
      : 0;

  const dataMov = op.dataHora ?? new Date();

  // 3) Grava movimento_estoque pra cada entrada (SAIDA_PRODUCAO).
  //    Saída usa o custo médio CORRENTE do produto (não muda o custo,
  //    só decrementa saldo).
  for (const e of entradas) {
    const qtd = Number(e.quantidade ?? 0);
    const preco =
      e.precoUnitario !== null
        ? Number(e.precoUnitario)
        : Number(e.produtoPrecoCusto ?? 0);
    const valor = qtd * preco;

    await db.insert(schema.movimentoEstoque).values({
      filialId: op.filialId,
      produtoId: e.produtoId,
      tipo: 'SAIDA_PRODUCAO',
      quantidade: (-qtd).toFixed(4),
      precoUnitario: preco.toFixed(6),
      valorTotal: valor.toFixed(2),
      dataHora: dataMov,
      ordemProducaoId: id,
      criadoPor: user.id,
    });

    await aplicarSaida({ produtoId: e.produtoId, qtdSaida: qtd });

    // Atualiza valor_total/preco_unitario da linha de entrada na OP
    await db
      .update(schema.ordemProducaoEntrada)
      .set({
        precoUnitario: preco.toFixed(6),
        valorTotal: valor.toFixed(2),
      })
      .where(eq(schema.ordemProducaoEntrada.id, e.id));
  }

  // 4) Grava saidas: ENTRADA_PRODUCAO pras tipo=PRODUTO, nada de movimento
  //    pras PERDA (mas ainda grava custoRateado=0 na linha pra UI).
  //    custo unit = pesoRelativo × (custoTotal / unidadesPesoUtil).
  //    O produto destino recebe o novo estoque via MPM (mistura com saldo
  //    anterior, se houver).
  const custoPorUnidadePeso = unidadesPesoUtil > 0 ? custoTotal / unidadesPesoUtil : 0;
  for (const s of saidas) {
    const qtd = Number(s.quantidade ?? 0);
    const peso = Number(s.pesoRelativo ?? 1);
    let custoUnit = 0;
    if (s.tipo === 'PRODUTO' && custoPorUnidadePeso > 0) {
      custoUnit = peso * custoPorUnidadePeso;
    }
    const valor = qtd * custoUnit;

    await db
      .update(schema.ordemProducaoSaida)
      .set({
        custoRateado: custoUnit.toFixed(6),
        valorTotal: valor.toFixed(2),
      })
      .where(eq(schema.ordemProducaoSaida.id, s.id));

    if (s.tipo === 'PRODUTO' && s.produtoId) {
      await db.insert(schema.movimentoEstoque).values({
        filialId: op.filialId,
        produtoId: s.produtoId,
        tipo: 'ENTRADA_PRODUCAO',
        quantidade: qtd.toFixed(4),
        precoUnitario: custoUnit.toFixed(6),
        valorTotal: valor.toFixed(2),
        dataHora: dataMov,
        ordemProducaoId: id,
        criadoPor: user.id,
      });

      // MPM: se Lâmina já tinha estoque a R$X/kg e agora entra mais
      // a R$Y/kg, o custo passa a ser média ponderada
      await aplicarMpmEntrada({
        produtoId: s.produtoId,
        qtdEntrada: qtd,
        custoEntrada: custoUnit,
      });
    }
  }

  // 5) Fecha a OP.
  await db
    .update(schema.ordemProducao)
    .set({
      status: 'CONCLUIDA',
      custoTotalEntradas: custoTotal.toFixed(2),
      divergenciaPercentual: divergenciaPerc.toFixed(4),
      concluidaEm: new Date(),
    })
    .where(eq(schema.ordemProducao.id, id));

  return NextResponse.json({
    id,
    ok: true,
    custoTotal: custoTotal.toFixed(2),
    divergenciaPercentual: divergenciaPerc.toFixed(4),
  });
}
