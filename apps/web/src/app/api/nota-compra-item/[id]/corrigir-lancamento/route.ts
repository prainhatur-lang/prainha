// POST /api/nota-compra-item/[id]/corrigir-lancamento
// Corrige um item de nota JÁ LANÇADO no estoque: produto errado e/ou fator
// errado (caixa com 24 que entrou como 1 un). Body: { produtoId, fator }.
//
// Caso real 14/10/2026 (CRBS, NF 496131): a Corona Zero entrou 1 un a
// R$ 167,20 (era a caixa) e uma das linhas da Zero entrou na Corona Extra.
// Antes o único jeito era excluir a entrada inteira e lançar de novo.
//
// O que faz, numa transação:
//   - o movimento ENTRADA_COMPRA do item passa a ter qtd = qtd do fornecedor
//     (conferência ou nota) × fator, no produto escolhido; o valor total não
//     muda (preço unitário = valor ÷ qtd nova);
//   - refaz saldo e custo médio do produto antigo e do novo a partir desse
//     movimento (lib/refazer-custo-medio): contagem feita depois continua
//     valendo; saídas (venda/ficha/ajuste) que gravaram o custo errado
//     ganham o custo certo (CMV);
//   - o item da nota aponta pro produto escolhido;
//   - o vínculo com o fornecedor fica com o código/EAN e o fator certos, pra
//     próxima nota já entrar certa.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { lerConferenciaNota } from '@/lib/nota-conferencia';
import type { ExecDb } from '@/lib/custo-medio';
import {
  gravarSaldoCusto,
  lerTrechoCusto,
  refazerTrecho,
  regravarSaidas,
  type MovRecalc,
} from '@/lib/refazer-custo-medio';
import { hojeBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  produtoId: z.string().uuid(),
  fator: z.number().positive().max(100000),
});

const EPS = 1e-6;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'nota_compra.lancar_estoque');
  if (semPerm) return semPerm;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  const { produtoId: produtoNovoId, fator } = parsed.data;

  const [item] = await db
    .select({
      id: schema.notaCompraItem.id,
      notaCompraId: schema.notaCompraItem.notaCompraId,
      filialId: schema.notaCompraItem.filialId,
      produtoId: schema.notaCompraItem.produtoId,
      quantidade: schema.notaCompraItem.quantidade,
      valorUnitario: schema.notaCompraItem.valorUnitario,
      codigo: schema.notaCompraItem.codigoProdutoFornecedor,
      ean: schema.notaCompraItem.ean,
      descricao: schema.notaCompraItem.descricao,
      unidade: schema.notaCompraItem.unidade,
    })
    .from(schema.notaCompraItem)
    .where(eq(schema.notaCompraItem.id, id))
    .limit(1);
  if (!item) return NextResponse.json({ error: 'item nao encontrado' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, item.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const [nota] = await db
    .select({
      fornecedorId: schema.notaCompra.fornecedorId,
      numero: schema.notaCompra.numero,
      dataEntrada: schema.notaCompra.dataEntrada,
      dataEmissao: schema.notaCompra.dataEmissao,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, item.notaCompraId))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [prodNovo] = await db
    .select({ id: schema.produto.id, filialId: schema.produto.filialId, nome: schema.produto.nome })
    .from(schema.produto)
    .where(eq(schema.produto.id, produtoNovoId))
    .limit(1);
  if (!prodNovo) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });
  if (prodNovo.filialId !== item.filialId) {
    return NextResponse.json({ error: 'produto em filial diferente' }, { status: 400 });
  }

  const movs = await db
    .select({
      id: schema.movimentoEstoque.id,
      produtoId: schema.movimentoEstoque.produtoId,
      quantidade: schema.movimentoEstoque.quantidade,
      precoUnitario: schema.movimentoEstoque.precoUnitario,
      observacao: schema.movimentoEstoque.observacao,
    })
    .from(schema.movimentoEstoque)
    .where(
      and(
        eq(schema.movimentoEstoque.notaCompraItemId, id),
        eq(schema.movimentoEstoque.tipo, 'ENTRADA_COMPRA'),
      ),
    );
  if (movs.length === 0) {
    return NextResponse.json(
      { error: 'item ainda não foi lançado — use "vincular" e depois lance a nota' },
      { status: 409 },
    );
  }
  if (movs.length > 1) {
    return NextResponse.json(
      { error: `item tem ${movs.length} entradas no estoque — corrija pela exclusão da entrada` },
      { status: 409 },
    );
  }
  const mov = movs[0]!;
  const produtoAntigoId = mov.produtoId;
  const [prodAntigo] = await db
    .select({ nome: schema.produto.nome })
    .from(schema.produto)
    .where(eq(schema.produto.id, produtoAntigoId))
    .limit(1);

  const qtdAntiga = Number(mov.quantidade ?? 0);
  const precoAntigo = Number(mov.precoUnitario ?? 0);
  const conferencia = await lerConferenciaNota(item.notaCompraId);
  const qtdFornecedor = conferencia.porItem.get(item.id) ?? Number(item.quantidade ?? 0);
  if (!(qtdFornecedor > 0)) {
    return NextResponse.json({ error: 'quantidade do item é zero' }, { status: 400 });
  }
  const qtdNova = qtdFornecedor * fator;
  const custoTotal = qtdAntiga * precoAntigo; // valor (com rateio) que entrou — não muda
  const precoNovo = qtdNova > 0 ? custoTotal / qtdNova : 0;
  const mudaProduto = produtoAntigoId !== produtoNovoId;
  const mudaEstoque = mudaProduto || Math.abs(qtdNova - qtdAntiga) > EPS;
  const dataMov = nota.dataEntrada ?? nota.dataEmissao ?? new Date();

  const resultado = await db.transaction(async (tx) => {
    const resumo: {
      produto: string;
      saldoAntes: number;
      custoAntes: number;
      saldoDepois: number;
      custoDepois: number;
      saidasRecusto: number;
    }[] = [];

    if (mudaEstoque) {
      const corrigido = (m: MovRecalc): MovRecalc => ({ ...m, quantidade: qtdNova, precoUnitario: precoNovo });

      const trA = await lerTrechoCusto(tx, produtoAntigoId, mov.id);
      if (trA.movs[0]?.id !== mov.id) throw new Error('trecho do produto antigo não começa no movimento');
      const movsA = mudaProduto
        ? trA.movs.filter((m) => m.id !== mov.id)
        : trA.movs.map((m) => (m.id === mov.id ? corrigido(m) : m));
      const rA = refazerTrecho(trA, movsA);
      await gravarSaldoCusto(tx, produtoAntigoId, rA);
      await regravarSaidas(tx, rA.saidas);
      resumo.push({
        produto: prodAntigo?.nome ?? produtoAntigoId,
        saldoAntes: trA.saldoAtual,
        custoAntes: trA.custoAtual,
        saldoDepois: rA.saldo,
        custoDepois: rA.custo,
        saidasRecusto: rA.saidas.length,
      });

      if (mudaProduto) {
        const trB = await lerTrechoCusto(tx, produtoNovoId, mov.id);
        const rB = refazerTrecho(trB, [corrigido(trA.movs[0]!), ...trB.movs]);
        await gravarSaldoCusto(tx, produtoNovoId, rB);
        await regravarSaidas(tx, rB.saidas);
        resumo.push({
          produto: prodNovo.nome ?? produtoNovoId,
          saldoAntes: trB.saldoAtual,
          custoAntes: trB.custoAtual,
          saldoDepois: rB.saldo,
          custoDepois: rB.custo,
          saidasRecusto: rB.saidas.length,
        });
      }

      const [d, m] = [hojeBr().slice(8, 10), hojeBr().slice(5, 7)];
      const obs = `corrigido ${d}/${m}: era ${fmt(qtdAntiga)} un${
        mudaProduto ? ` de ${prodAntigo?.nome ?? '?'}` : ''
      } a R$ ${precoAntigo.toFixed(4).replace('.', ',')}`;
      await tx
        .update(schema.movimentoEstoque)
        .set({
          produtoId: produtoNovoId,
          quantidade: qtdNova.toFixed(4),
          precoUnitario: precoNovo.toFixed(6),
          observacao: [mov.observacao, obs].filter(Boolean).join(' · '),
        })
        .where(eq(schema.movimentoEstoque.id, mov.id));
    }

    if (item.produtoId !== produtoNovoId) {
      await tx
        .update(schema.notaCompraItem)
        .set({ produtoId: produtoNovoId, semVinculoAuto: false })
        .where(eq(schema.notaCompraItem.id, id));
    }

    const aviso = nota.fornecedorId
      ? await acertarVinculo(tx, {
          filialId: item.filialId,
          fornecedorId: nota.fornecedorId,
          produtoNovoId,
          produtoAntigoId,
          codigo: item.codigo?.trim() || null,
          ean: item.ean?.trim() || null,
          descricao: item.descricao,
          unidade: item.unidade,
          fator,
          valorUnitario: Number(item.valorUnitario ?? 0),
          dataMov,
        })
      : null;

    return { resumo, aviso };
  });

  return NextResponse.json({
    ok: true,
    qtdAntiga,
    qtdNova,
    precoAntigo,
    precoNovo,
    mudouEstoque: mudaEstoque,
    produtos: resultado.resumo,
    ...(resultado.aviso ? { aviso: resultado.aviso } : {}),
  });
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace('.', ',');
}

/** Deixa o vínculo produto×fornecedor com o código/EAN e o fator do item. */
async function acertarVinculo(
  tx: ExecDb,
  o: {
    filialId: string;
    fornecedorId: string;
    produtoNovoId: string;
    produtoAntigoId: string;
    codigo: string | null;
    ean: string | null;
    descricao: string | null;
    unidade: string | null;
    fator: number;
    valorUnitario: number;
    dataMov: Date;
  },
): Promise<string | null> {
  const pf = schema.produtoFornecedor;
  const fatorStr = String(o.fator);
  const ultimo = {
    ultimoPrecoCusto: o.valorUnitario.toFixed(4),
    ultimoPrecoCustoUnidade: (o.valorUnitario / o.fator).toFixed(6),
    ultimaCompraEm: o.dataMov,
  };
  // último preço só se esta nota não for mais velha que a última compra gravada
  const dados = (ultimaCompraEm: Date | null) => ({
    ...(o.ean ? { ean: o.ean } : {}),
    descricaoFornecedor: o.descricao,
    unidadeFornecedor: o.unidade,
    fatorConversao: fatorStr,
    ...(!ultimaCompraEm || ultimaCompraEm <= o.dataMov ? ultimo : {}),
    atualizadoEm: new Date(),
  });
  let aviso: string | null = null;

  const doNovo = await tx
    .select({ id: pf.id, codigo: pf.codigoFornecedor, ean: pf.ean, ultimaCompraEm: pf.ultimaCompraEm })
    .from(pf)
    .where(and(eq(pf.fornecedorId, o.fornecedorId), eq(pf.produtoId, o.produtoNovoId)));

  if (o.codigo) {
    const [dono] = await tx
      .select({ id: pf.id, produtoId: pf.produtoId, nome: schema.produto.nome, ultimaCompraEm: pf.ultimaCompraEm })
      .from(pf)
      .innerJoin(schema.produto, eq(schema.produto.id, pf.produtoId))
      .where(and(eq(pf.fornecedorId, o.fornecedorId), eq(pf.codigoFornecedor, o.codigo)))
      .limit(1);

    if (dono && dono.produtoId === o.produtoNovoId) {
      await tx.update(pf).set(dados(dono.ultimaCompraEm)).where(eq(pf.id, dono.id));
      return null;
    }
    if (dono && dono.produtoId === o.produtoAntigoId) {
      // o código era do produto de onde o item saiu: passa pro produto certo
      // (o vínculo antigo fica, sem o código)
      await tx.update(pf).set({ codigoFornecedor: null, atualizadoEm: new Date() }).where(eq(pf.id, dono.id));
    } else if (dono) {
      // código ligado a um terceiro produto: não mexe, grava sem o código
      aviso = `O código ${o.codigo} do fornecedor está ligado a "${dono.nome}" — o vínculo deste item foi salvo sem o código, com o fator ${fatorStr}.`;
    }
    const codigoLivre = !dono || dono.produtoId === o.produtoAntigoId;
    const semCodigo = doNovo.find((v) => !v.codigo && (!o.ean || !v.ean || v.ean === o.ean)) ?? doNovo.find((v) => !v.codigo);
    if (semCodigo) {
      await tx
        .update(pf)
        .set({ ...dados(semCodigo.ultimaCompraEm), ...(codigoLivre ? { codigoFornecedor: o.codigo } : {}) })
        .where(eq(pf.id, semCodigo.id));
    } else {
      await tx.insert(pf).values({
        filialId: o.filialId,
        produtoId: o.produtoNovoId,
        fornecedorId: o.fornecedorId,
        codigoFornecedor: codigoLivre ? o.codigo : null,
        ean: o.ean,
        descricaoFornecedor: o.descricao,
        unidadeFornecedor: o.unidade,
        fatorConversao: fatorStr,
        ...ultimo,
      });
    }
    return aviso;
  }

  // item sem código: vínculo pelo EAN ou o primeiro do produto
  const alvo = (o.ean ? doNovo.find((v) => v.ean === o.ean) : undefined) ?? doNovo[0];
  if (alvo) {
    await tx.update(pf).set(dados(alvo.ultimaCompraEm)).where(eq(pf.id, alvo.id));
  } else {
    await tx.insert(pf).values({
      filialId: o.filialId,
      produtoId: o.produtoNovoId,
      fornecedorId: o.fornecedorId,
      codigoFornecedor: null,
      ean: o.ean,
      descricaoFornecedor: o.descricao,
      unidadeFornecedor: o.unidade,
      fatorConversao: fatorStr,
      ...ultimo,
    });
  }
  return null;
}
