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
// Tudo numa transação com a OP travada (FOR UPDATE): duplo clique ou erro no
// meio não deixa estoque meio-baixado nem a OP concluída duas vezes.
// Cancelar depois (cancelar/route.ts) estorna tudo isso.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';
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

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .innerJoin(schema.ordemProducao, eq(schema.ordemProducao.filialId, schema.usuarioFilial.filialId))
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.ordemProducao.id, id),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'OP nao encontrada ou sem acesso' }, { status: 404 });

  class Recusa extends Error {}

  try {
    const r = await db.transaction(async (tx) => {
      const [op] = await tx
        .select()
        .from(schema.ordemProducao)
        .where(eq(schema.ordemProducao.id, id))
        .for('update')
        .limit(1);
      if (!op) throw new Recusa('OP nao encontrada');
      if (op.status !== 'RASCUNHO') throw new Recusa(`OP ${op.status} nao pode ser concluida`);

      const entradas = await tx
        .select({
          id: schema.ordemProducaoEntrada.id,
          produtoId: schema.ordemProducaoEntrada.produtoId,
          quantidade: schema.ordemProducaoEntrada.quantidade,
          precoUnitario: schema.ordemProducaoEntrada.precoUnitario,
          pesoTotalKg: schema.ordemProducaoEntrada.pesoTotalKg,
          produtoPrecoCusto: schema.produto.precoCusto,
          produtoUnidade: schema.produto.unidadeEstoque,
        })
        .from(schema.ordemProducaoEntrada)
        .innerJoin(schema.produto, eq(schema.produto.id, schema.ordemProducaoEntrada.produtoId))
        .where(eq(schema.ordemProducaoEntrada.ordemProducaoId, id));
      if (entradas.length === 0) throw new Recusa('adicione pelo menos uma entrada antes de concluir');

      const saidas = await tx
        .select()
        .from(schema.ordemProducaoSaida)
        .where(eq(schema.ordemProducaoSaida.ordemProducaoId, id));
      if (saidas.length === 0) throw new Recusa('adicione pelo menos uma saida antes de concluir');

      // Produto de saída que não controla estoque: a entrada some no vácuo
      // (ex.: OP que produziu o prato de venda em vez do insumo que a ficha
      // técnica dele consome). Recusa e diz o que fazer.
      const idsSaida = saidas.filter((s) => s.tipo === 'PRODUTO' && s.produtoId).map((s) => s.produtoId!);
      const infoSaida = idsSaida.length
        ? await tx
            .select({
              id: schema.produto.id,
              nome: schema.produto.nome,
              unidade: schema.produto.unidadeEstoque,
              controla: schema.produto.controlaEstoque,
            })
            .from(schema.produto)
            .where(inArray(schema.produto.id, idsSaida))
        : [];
      const semControle = infoSaida.filter((p) => !p.controla);
      if (semControle.length) {
        throw new Recusa(
          `${semControle.map((p) => p.nome).join(', ')} não controla estoque — a produção não ficaria em lugar nenhum. ` +
            'Troque a saída pelo INSUMO que a ficha técnica do prato consome (ou ligue "controla estoque" no produto).',
        );
      }
      const unidadeSaida = new Map(infoSaida.map((p) => [p.id, p.unidade]));

      // 1) Custo total das entradas. Prioridade do preço unitário:
      //    1º) preco_unitario da própria linha de entrada (se user editou)
      //    2º) produto.preco_custo CORRENTE (custo médio do estoque atual)
      //    3º) 0
      //
      //    A escolha 2 garante que a OP consume o filé pelo CUSTO REAL DO
      //    ESTOQUE no momento da conclusão (que é o MPM atualizado pela última
      //    NFe + frete rateado), não o "último custo de compra".
      const precoEntrada = (e: (typeof entradas)[number]) =>
        e.precoUnitario !== null ? Number(e.precoUnitario) : Number(e.produtoPrecoCusto ?? 0);
      const custoTotal = entradas.reduce((s, e) => s + Number(e.quantidade ?? 0) * precoEntrada(e), 0);

      // 2) Rateio por UNIDADES-PESO das saidas PRODUTO. Perdas absorvem custo
      //    automaticamente (não entram no denominador). Cortes nobres (peso>1)
      //    absorvem mais; populares (peso<1) absorvem menos.
      const saidasUteis = saidas.filter((s) => s.tipo === 'PRODUTO');
      const unidadesPesoUtil = saidasUteis.reduce(
        (s, r) => s + Number(r.quantidade ?? 0) * Number(r.pesoRelativo ?? 1),
        0,
      );

      // Divergência: por PESO quando toda linha tem kg (mesma regra do editor);
      // senão por quantidade. Somar 10,5 kg com 25 porções dava -142%.
      const kg = (qtd: number, unidade: string | null | undefined, pesoKg: unknown, perdaLivre: boolean) => {
        if (perdaLivre) return qtd;
        const u = (unidade ?? '').toLowerCase();
        if (u === 'kg') return qtd;
        if (u === 'g') return qtd / 1000;
        const p = Number(pesoKg ?? 0);
        return p > 0 ? p : NaN;
      };
      const kgEnt = entradas.map((e) => kg(Number(e.quantidade ?? 0), e.produtoUnidade, e.pesoTotalKg, false));
      const kgSai = saidas.map((s) =>
        kg(
          Number(s.quantidade ?? 0),
          s.produtoId ? unidadeSaida.get(s.produtoId) : null,
          s.pesoTotalKg,
          s.tipo === 'PERDA' && !s.produtoId,
        ),
      );
      const somaKgEnt = kgEnt.reduce((a, b) => a + b, 0);
      const somaKgSai = kgSai.reduce((a, b) => a + b, 0);
      const qtdTotalEntradas = entradas.reduce((s, e) => s + Number(e.quantidade ?? 0), 0);
      const qtdTotalSaidas = saidas.reduce((s, r) => s + Number(r.quantidade ?? 0), 0);
      const divergenciaPerc =
        Number.isFinite(somaKgEnt) && Number.isFinite(somaKgSai) && somaKgEnt > 0
          ? ((somaKgEnt - somaKgSai) / somaKgEnt) * 100
          : qtdTotalEntradas > 0
            ? ((qtdTotalEntradas - qtdTotalSaidas) / qtdTotalEntradas) * 100
            : 0;

      const dataMov = op.dataHora ?? new Date();

      // 3) Grava movimento_estoque pra cada entrada (SAIDA_PRODUCAO).
      //    Saída usa o custo médio CORRENTE do produto (não muda o custo,
      //    só decrementa saldo).
      for (const e of entradas) {
        const qtd = Number(e.quantidade ?? 0);
        const preco = precoEntrada(e);
        const valor = qtd * preco;

        await tx.insert(schema.movimentoEstoque).values({
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

        await aplicarSaida({ produtoId: e.produtoId, qtdSaida: qtd, exec: tx });

        // Atualiza valor_total/preco_unitario da linha de entrada na OP
        await tx
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
        const custoUnit = s.tipo === 'PRODUTO' && custoPorUnidadePeso > 0 ? peso * custoPorUnidadePeso : 0;
        const valor = qtd * custoUnit;

        await tx
          .update(schema.ordemProducaoSaida)
          .set({
            custoRateado: custoUnit.toFixed(6),
            valorTotal: valor.toFixed(2),
          })
          .where(eq(schema.ordemProducaoSaida.id, s.id));

        if (s.tipo === 'PRODUTO' && s.produtoId) {
          await tx.insert(schema.movimentoEstoque).values({
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
            exec: tx,
          });
        }
      }

      // 5) Fecha a OP.
      await tx
        .update(schema.ordemProducao)
        .set({
          status: 'CONCLUIDA',
          custoTotalEntradas: custoTotal.toFixed(2),
          divergenciaPercentual: divergenciaPerc.toFixed(4),
          concluidaEm: new Date(),
        })
        .where(eq(schema.ordemProducao.id, id));

      return { custoTotal, divergenciaPerc };
    });

    return NextResponse.json({
      id,
      ok: true,
      custoTotal: r.custoTotal.toFixed(2),
      divergenciaPercentual: r.divergenciaPerc.toFixed(4),
    });
  } catch (e) {
    if (e instanceof Recusa) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
