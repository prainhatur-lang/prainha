// Agregacoes do Dashboard de Fechamento de Mes (por filial).
// Cruza vendas (pedido/pagamento) + extrato bancario (lancamento_banco) +
// despesas/fornecedores (conta_pagar). Datas em BRT (ver lib/datas).

import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, inArray, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import { brDateStart, brDateEnd, hojeBr } from './datas';

const num = (v: string | number | null): number => (v == null ? 0 : Number(v));

function mesBounds(ano: number, mes: number) {
  const mm = String(mes).padStart(2, '0');
  const lastDay = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const ymdStart = `${ano}-${mm}-01`;
  const ymdEnd = `${ano}-${mm}-${String(lastDay).padStart(2, '0')}`;
  return { ymdStart, ymdEnd, tsStart: brDateStart(ymdStart), tsEnd: brDateEnd(ymdEnd) };
}

export type DashboardFechamento = Awaited<ReturnType<typeof dashboardFechamento>>;

/** Resumo leve de um mes (3 agregados) — usado na evolucao mensal. */
async function resumoMes(filialId: string, ano: number, mes: number) {
  const { ymdStart, ymdEnd, tsStart, tsEnd } = mesBounds(ano, mes);

  const [fat] = await db
    .select({ v: sql<string>`coalesce(sum(${schema.pedido.valorTotal}),0)` })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        isNull(schema.pedido.dataDelete),
        gte(schema.pedido.dataFechamento, tsStart),
        lte(schema.pedido.dataFechamento, tsEnd),
      ),
    );

  const [desp] = await db
    .select({ v: sql<string>`coalesce(sum(coalesce(${schema.contaPagar.valorPago},${schema.contaPagar.valor})),0)` })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.filialId, filialId),
        isNull(schema.contaPagar.borderoId),
        isNotNull(schema.contaPagar.dataPagamento),
        gte(schema.contaPagar.dataPagamento, ymdStart),
        lte(schema.contaPagar.dataPagamento, ymdEnd),
      ),
    );

  const [banco] = await db
    .select({
      entradas: sql<string>`coalesce(sum(${schema.lancamentoBanco.valor}) filter (where ${schema.lancamentoBanco.tipo}='C'),0)`,
      saidas: sql<string>`coalesce(sum(${schema.lancamentoBanco.valor}) filter (where ${schema.lancamentoBanco.tipo}='D'),0)`,
    })
    .from(schema.lancamentoBanco)
    .where(
      and(
        eq(schema.lancamentoBanco.filialId, filialId),
        gte(schema.lancamentoBanco.dataMovimento, ymdStart),
        lte(schema.lancamentoBanco.dataMovimento, ymdEnd),
      ),
    );

  const faturamento = num(fat.v);
  const despesas = num(desp.v);
  const entradas = num(banco.entradas);
  const saidas = num(banco.saidas);
  return {
    ano,
    mes,
    faturamento,
    despesas,
    entradas,
    saidas,
    saldoBanco: entradas - saidas,
    resultado: faturamento - despesas,
    margem: faturamento ? ((faturamento - despesas) / faturamento) * 100 : 0,
  };
}

/** Ultimos N meses ate (ano,mes), do mais antigo pro mais novo. */
export async function evolucaoMensal(filialId: string, ano: number, mes: number, n = 6) {
  const meses: Array<{ ano: number; mes: number }> = [];
  let a = ano;
  let m = mes;
  for (let i = 0; i < n; i++) {
    meses.unshift({ ano: a, mes: m });
    m -= 1;
    if (m === 0) { m = 12; a -= 1; }
  }
  return Promise.all(meses.map((x) => resumoMes(filialId, x.ano, x.mes)));
}

export async function dashboardFechamento(filialId: string, ano: number, mes: number) {
  const { ymdStart, ymdEnd, tsStart, tsEnd } = mesBounds(ano, mes);

  // --- Vendas ativas ---
  const [vendas] = await db
    .select({
      faturamento: sql<string>`coalesce(sum(${schema.pedido.valorTotal}),0)`,
      pedidos: sql<number>`count(*)::int`,
      pessoas: sql<number>`coalesce(sum(${schema.pedido.quantidadePessoas}),0)::int`,
      descontos: sql<string>`coalesce(sum(${schema.pedido.totalDesconto}),0)`,
      acrescimos: sql<string>`coalesce(sum(${schema.pedido.totalAcrescimo}),0)`,
      servico: sql<string>`coalesce(sum(${schema.pedido.totalServico}),0)`,
    })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        isNull(schema.pedido.dataDelete),
        gte(schema.pedido.dataFechamento, tsStart),
        lte(schema.pedido.dataFechamento, tsEnd),
      ),
    );

  const [canc] = await db
    .select({ q: sql<number>`count(*)::int`, valor: sql<string>`coalesce(sum(${schema.pedido.valorTotal}),0)` })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        isNotNull(schema.pedido.dataDelete),
        gte(schema.pedido.dataFechamento, tsStart),
        lte(schema.pedido.dataFechamento, tsEnd),
        // Excluido que so ganhou data de fechamento dias depois nao foi cancelado no mes: o
        // "nao compareceu" datou 3.275 excluidos antigos (2019 em diante) em ago–out/2026 e este
        // quadro mostrou R$ 148 mil de "cancelado" em set/2026 no Prainha Bar. No PDV o pedido e
        // fechado e excluido no mesmo momento (os 3 casos do historico: menos de 1 h de distancia).
        sql`${schema.pedido.dataFechamento} <= ${schema.pedido.dataDelete} + interval '1 day'`,
      ),
    );

  // O que o caixa da loja cancelou no mes, item a item ou o pedido inteiro, com o valor de cada um
  // (registro do vendas-local; comeca em ago/2026 — mes anterior vem zerado).
  const [cancCaixa] = await db
    .select({
      q: sql<number>`count(*)::int`,
      pedidos: sql<number>`(count(*) filter (where ${schema.cancelamentoItem.tipo} = 'pedido'))::int`,
      valor: sql<string>`coalesce(sum(${schema.cancelamentoItem.valor}),0)`,
    })
    .from(schema.cancelamentoItem)
    .where(
      and(
        eq(schema.cancelamentoItem.filialId, filialId),
        gte(schema.cancelamentoItem.quando, tsStart),
        lte(schema.cancelamentoItem.quando, tsEnd),
      ),
    );

  const [itens] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.pedidoItem)
    .innerJoin(schema.pedido, eq(schema.pedido.id, schema.pedidoItem.pedidoId))
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        isNull(schema.pedido.dataDelete),
        gte(schema.pedido.dataFechamento, tsStart),
        lte(schema.pedido.dataFechamento, tsEnd),
      ),
    );

  // Forma de pagamento: parte do VALOR TOTAL real (pagamento) e usa
  // pagamento.formaPagamento quando existe; senão pega da NFC-e ligada
  // (nf_venda_pagamento.t_pag) por pagamento_id. Classifica ~90%; o resto fica
  // "Não identificado" (a origem não traz a forma dessas linhas — gap do sync).
  // Forma de pagamento: 3 selects simples + classificação em JS (robusto; o
  // query-builder não correlacionava o subquery e o db.execute deu problema de
  // tipo/retorno). Prioridade: canal delivery > pagamento.forma > NFC-e ligada.
  const pgRows = await db
    .select({
      id: schema.pagamento.id,
      valor: schema.pagamento.valor,
      forma: schema.pagamento.formaPagamento,
      codPedido: schema.pagamento.codigoPedidoExterno,
    })
    .from(schema.pagamento)
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        gte(schema.pagamento.dataPagamento, tsStart),
        lte(schema.pagamento.dataPagamento, tsEnd),
      ),
    );

  const codPedidos = [...new Set(pgRows.map((r) => r.codPedido).filter((x): x is number => x != null))];
  const pedRows = codPedidos.length
    ? await db
        .select({ cod: schema.pedido.codigoExterno, origem: schema.pedido.codigoPedidoOrigem })
        .from(schema.pedido)
        .where(and(eq(schema.pedido.filialId, filialId), inArray(schema.pedido.codigoExterno, codPedidos)))
    : [];
  const origemMap = new Map<number, number | null>();
  for (const r of pedRows) if (r.cod != null) origemMap.set(r.cod, r.origem);

  const pgIds = pgRows.map((r) => r.id);
  const nfpRows = pgIds.length
    ? await db
        .select({
          pid: schema.nfVendaPagamento.pagamentoId,
          tPag: schema.nfVendaPagamento.tPag,
          xPag: schema.nfVendaPagamento.xPag,
        })
        .from(schema.nfVendaPagamento)
        .where(inArray(schema.nfVendaPagamento.pagamentoId, pgIds))
    : [];
  const nfpMap = new Map<string, { tPag: number | null; xPag: string | null }>();
  for (const r of nfpRows) if (r.pid && !nfpMap.has(r.pid)) nfpMap.set(r.pid, { tPag: r.tPag, xPag: r.xPag });

  const TPAG: Record<number, string> = {
    1: 'Dinheiro', 2: 'Cheque', 3: 'Cartão de Crédito', 4: 'Cartão de Débito',
    5: 'Crédito Loja', 15: 'Boleto', 16: 'Depósito Bancário', 17: 'PIX', 18: 'Transferência',
  };
  const classificar = (r: (typeof pgRows)[number]): string => {
    const o = r.codPedido != null ? origemMap.get(r.codPedido) : undefined;
    if (o === 4 || o === 7) return 'iFood Online';
    if (o === 5 || o === 6) return 'MenuDino';
    if (r.forma && r.forma.trim()) return r.forma.trim();
    const nf = nfpMap.get(r.id);
    if (nf?.tPag != null) {
      if (nf.tPag === 99) return nf.xPag && nf.xPag.trim() ? nf.xPag.trim() : 'Outros';
      if (TPAG[nf.tPag]) return TPAG[nf.tPag];
    }
    return 'Não identificado';
  };
  const formasAgg = new Map<string, { total: number; qtd: number }>();
  for (const r of pgRows) {
    const label = classificar(r);
    const cur = formasAgg.get(label) ?? { total: 0, qtd: 0 };
    cur.total += num(r.valor);
    cur.qtd += 1;
    formasAgg.set(label, cur);
  }
  const formasArr = [...formasAgg.entries()]
    .map(([forma, v]) => ({ forma, total: v.total, qtd: v.qtd }))
    .sort((a, b) => b.total - a.total);

  const topProdutos = await db
    .select({
      nome: schema.pedidoItem.nomeProduto,
      valor: sql<string>`coalesce(sum(${schema.pedidoItem.valorTotal}),0)`,
      qtd: sql<string>`coalesce(sum(${schema.pedidoItem.quantidade}),0)`,
    })
    .from(schema.pedidoItem)
    .innerJoin(schema.pedido, eq(schema.pedido.id, schema.pedidoItem.pedidoId))
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        isNull(schema.pedido.dataDelete),
        gte(schema.pedido.dataFechamento, tsStart),
        lte(schema.pedido.dataFechamento, tsEnd),
      ),
    )
    .groupBy(schema.pedidoItem.nomeProduto)
    .orderBy(desc(sql`sum(${schema.pedidoItem.valorTotal})`))
    .limit(10);

  // --- Banco (extrato) por conta ---
  const bancoContas = await db
    .select({
      banco: schema.contaBancaria.banco,
      apelido: schema.contaBancaria.apelido,
      entradas: sql<string>`coalesce(sum(${schema.lancamentoBanco.valor}) filter (where ${schema.lancamentoBanco.tipo}='C'),0)`,
      saidas: sql<string>`coalesce(sum(${schema.lancamentoBanco.valor}) filter (where ${schema.lancamentoBanco.tipo}='D'),0)`,
    })
    .from(schema.lancamentoBanco)
    .leftJoin(schema.contaBancaria, eq(schema.contaBancaria.id, schema.lancamentoBanco.contaBancariaId))
    .where(
      and(
        eq(schema.lancamentoBanco.filialId, filialId),
        gte(schema.lancamentoBanco.dataMovimento, ymdStart),
        lte(schema.lancamentoBanco.dataMovimento, ymdEnd),
      ),
    )
    .groupBy(schema.contaBancaria.banco, schema.contaBancaria.apelido)
    .orderBy(desc(sql`sum(${schema.lancamentoBanco.valor})`));

  // --- Despesas (conta a pagar) ---
  const [despPagas] = await db
    .select({
      total: sql<string>`coalesce(sum(coalesce(${schema.contaPagar.valorPago},${schema.contaPagar.valor})),0)`,
      q: sql<number>`count(*)::int`,
    })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.filialId, filialId),
        isNull(schema.contaPagar.borderoId),
        isNotNull(schema.contaPagar.dataPagamento),
        gte(schema.contaPagar.dataPagamento, ymdStart),
        lte(schema.contaPagar.dataPagamento, ymdEnd),
      ),
    );

  const [despAbertas] = await db
    .select({
      total: sql<string>`coalesce(sum(${schema.contaPagar.valor}),0)`,
      q: sql<number>`count(*)::int`,
    })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.filialId, filialId),
        isNull(schema.contaPagar.borderoId),
        isNull(schema.contaPagar.dataPagamento),
        gte(schema.contaPagar.dataVencimento, ymdStart),
        lte(schema.contaPagar.dataVencimento, ymdEnd),
      ),
    );

  // --- Resultado com tudo pago (competência = vencimento no mês) ---
  // O quadro acima conta só o que foi PAGO no mês (caixa). Este conta tudo o que VENCE no mês,
  // pago ou não — o resultado "se tivesse dado pra pagar tudo". Fica de fora:
  //  · conta excluída e conta que entrou num borderô (conta o borderô, como no quadro de caixa);
  //  · ENCONTRO_CONTAS: acerto entre as casas que compensa transferências e boletos que já
  //    estão lançados como despesa — somar de novo seria contar duas vezes;
  //  · provisão do Consumer ("PROVISIONAMENTO ...") quando a conta de verdade do mesmo
  //    fornecedor ou da mesma categoria já está lançada no mês (o Consumer nunca baixa a
  //    provisão quando a conta real é paga). Provisão sem conta real fica, como estimativa.
  // Pagamento parcial: o pedaço pago entra em "pagas", o saldo em "em aberto".
  const tpRows = (await db.execute(sql`
    WITH mes AS (
      SELECT c.id, c.valor, c.valor_pago, c.data_pagamento, c.data_vencimento, c.origem, c.fornecedor_id, c.categoria_id,
             (c.origem = 'CONSUMER' AND ltrim(coalesce(c.descricao, '')) ILIKE 'provis%') AS provisao
        FROM conta_pagar c
       WHERE c.filial_id = ${filialId}::uuid
         AND c.data_delete IS NULL
         AND c.bordero_id IS NULL
         AND c.data_vencimento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date
    ), cls AS (
      SELECT m.*,
             CASE
               WHEN m.origem = 'ENCONTRO_CONTAS' THEN 'encontro'
               WHEN m.data_pagamento IS NOT NULL THEN 'paga'
               WHEN m.provisao AND EXISTS (
                 SELECT 1 FROM conta_pagar o
                  WHERE o.filial_id = ${filialId}::uuid
                    AND o.id <> m.id
                    AND o.data_delete IS NULL
                    AND o.data_vencimento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date
                    AND NOT (o.origem = 'CONSUMER' AND ltrim(coalesce(o.descricao, '')) ILIKE 'provis%')
                    AND (o.fornecedor_id = m.fornecedor_id OR o.categoria_id = m.categoria_id)
               ) THEN 'provisao_coberta'
               ELSE 'aberta'
             END AS tipo
        FROM mes m
    )
    SELECT
      (coalesce(sum(coalesce(valor_pago, valor)) FILTER (WHERE tipo = 'paga'), 0)
        + coalesce(sum(coalesce(valor_pago, 0)) FILTER (WHERE tipo = 'aberta'), 0))::float8 AS pagas,
      count(*) FILTER (WHERE tipo = 'paga')::int AS qtd_pagas,
      (coalesce(sum(coalesce(valor_pago, valor)) FILTER (WHERE tipo = 'paga'
          AND data_pagamento NOT BETWEEN ${ymdStart}::date AND ${ymdEnd}::date), 0)
        + coalesce(sum(coalesce(valor_pago, 0)) FILTER (WHERE tipo = 'aberta'), 0))::float8 AS pagas_fora,
      coalesce(sum(greatest(valor - coalesce(valor_pago, 0), 0)) FILTER (WHERE tipo = 'aberta'), 0)::float8 AS aberto,
      count(*) FILTER (WHERE tipo = 'aberta' AND valor - coalesce(valor_pago, 0) > 0.004)::int AS qtd_aberto,
      coalesce(sum(greatest(valor - coalesce(valor_pago, 0), 0)) FILTER (WHERE tipo = 'aberta' AND provisao), 0)::float8 AS provisoes_abertas,
      count(*) FILTER (WHERE tipo = 'aberta' AND provisao)::int AS qtd_provisoes_abertas,
      coalesce(sum(valor) FILTER (WHERE tipo = 'provisao_coberta'), 0)::float8 AS provisoes_cobertas,
      count(*) FILTER (WHERE tipo = 'provisao_coberta')::int AS qtd_provisoes_cobertas,
      coalesce(sum(valor) FILTER (WHERE tipo = 'encontro'), 0)::float8 AS encontro,
      count(*) FILTER (WHERE tipo = 'encontro')::int AS qtd_encontro,
      coalesce(sum(greatest(valor - coalesce(valor_pago, 0), 0)) FILTER (WHERE tipo = 'aberta'
        AND data_vencimento > ${hojeBr()}::date), 0)::float8 AS aberto_a_vencer
    FROM cls
  `)) as unknown as {
    pagas: number;
    qtd_pagas: number;
    pagas_fora: number;
    aberto: number;
    qtd_aberto: number;
    provisoes_abertas: number;
    qtd_provisoes_abertas: number;
    provisoes_cobertas: number;
    qtd_provisoes_cobertas: number;
    encontro: number;
    qtd_encontro: number;
    aberto_a_vencer: number;
  }[];
  const tp = tpRows[0];

  // Ponte com o quadro de caixa: o que ele soma (pago no mês) e este não.
  const ponteRows = (await db.execute(sql`
    SELECT
      coalesce(sum(coalesce(valor_pago, valor)) FILTER (WHERE data_delete IS NOT NULL), 0)::float8 AS excluidas,
      coalesce(sum(coalesce(valor_pago, valor)) FILTER (WHERE data_delete IS NULL
        AND (data_vencimento IS NULL OR data_vencimento NOT BETWEEN ${ymdStart}::date AND ${ymdEnd}::date)), 0)::float8 AS outros_meses,
      coalesce(sum(coalesce(valor_pago, valor)) FILTER (WHERE data_delete IS NULL
        AND data_vencimento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date
        AND origem = 'ENCONTRO_CONTAS'), 0)::float8 AS encontro_pago
      FROM conta_pagar
     WHERE filial_id = ${filialId}::uuid
       AND bordero_id IS NULL
       AND data_pagamento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date
  `)) as unknown as { excluidas: number; outros_meses: number; encontro_pago: number }[];
  const ponte = ponteRows[0];

  // Sobrou ou faltou? O que saiu de verdade no mês (sem excluída, sem borderô, sem encontro de
  // contas) e quanto disso pagou conta de outro mês. Com o "em aberto" e as "pagas fora do mês"
  // da consulta de cima dá pra separar a sobra de verdade da sobra que só existe porque ficou
  // conta sem pagar: sobra de verdade = vendas − pago no mês − contas do mês não pagas no mês.
  const cxRows = (await db.execute(sql`
    SELECT
      coalesce(sum(coalesce(valor_pago, valor)) FILTER (WHERE origem IS DISTINCT FROM 'ENCONTRO_CONTAS'
        AND data_pagamento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date), 0)::float8 AS pago_no_mes,
      coalesce(sum(coalesce(valor_pago, valor)) FILTER (WHERE origem IS DISTINCT FROM 'ENCONTRO_CONTAS'
        AND data_pagamento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date
        AND (data_vencimento IS NULL OR data_vencimento < ${ymdStart}::date)), 0)::float8 AS de_meses_anteriores,
      coalesce(sum(coalesce(valor_pago, valor)) FILTER (WHERE origem IS DISTINCT FROM 'ENCONTRO_CONTAS'
        AND data_pagamento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date
        AND data_vencimento > ${ymdEnd}::date), 0)::float8 AS adiantadas,
      coalesce(sum(coalesce(valor_pago, valor)) FILTER (WHERE origem IS DISTINCT FROM 'ENCONTRO_CONTAS'
        AND data_vencimento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date
        AND data_pagamento > ${ymdEnd}::date), 0)::float8 AS pagas_depois,
      coalesce(sum(coalesce(valor_pago, valor)) FILTER (WHERE origem = 'ENCONTRO_CONTAS'
        AND data_pagamento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date), 0)::float8 AS encontro_no_mes
      FROM conta_pagar
     WHERE filial_id = ${filialId}::uuid
       AND data_delete IS NULL
       AND bordero_id IS NULL
       AND (data_pagamento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date
            OR (data_vencimento BETWEEN ${ymdStart}::date AND ${ymdEnd}::date AND data_pagamento > ${ymdEnd}::date))
  `)) as unknown as {
    pago_no_mes: number;
    de_meses_anteriores: number;
    adiantadas: number;
    pagas_depois: number;
    encontro_no_mes: number;
  }[];
  const cx = cxRows[0];

  const topFornecedores = await db
    .select({
      nome: schema.fornecedor.nome,
      total: sql<string>`coalesce(sum(coalesce(${schema.contaPagar.valorPago},${schema.contaPagar.valor})),0)`,
    })
    .from(schema.contaPagar)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(
      and(
        eq(schema.contaPagar.filialId, filialId),
        isNull(schema.contaPagar.borderoId),
        isNotNull(schema.contaPagar.dataPagamento),
        gte(schema.contaPagar.dataPagamento, ymdStart),
        lte(schema.contaPagar.dataPagamento, ymdEnd),
      ),
    )
    .groupBy(schema.fornecedor.nome)
    .orderBy(desc(sql`sum(coalesce(${schema.contaPagar.valorPago},${schema.contaPagar.valor}))`))
    .limit(8);

  const porCategoria = await db
    .select({
      categoria: schema.categoriaConta.descricao,
      total: sql<string>`coalesce(sum(coalesce(${schema.contaPagar.valorPago},${schema.contaPagar.valor})),0)`,
    })
    .from(schema.contaPagar)
    .leftJoin(schema.categoriaConta, eq(schema.categoriaConta.id, schema.contaPagar.categoriaId))
    .where(
      and(
        eq(schema.contaPagar.filialId, filialId),
        isNull(schema.contaPagar.borderoId),
        isNotNull(schema.contaPagar.dataPagamento),
        gte(schema.contaPagar.dataPagamento, ymdStart),
        lte(schema.contaPagar.dataPagamento, ymdEnd),
      ),
    )
    .groupBy(schema.categoriaConta.descricao)
    .orderBy(desc(sql`sum(coalesce(${schema.contaPagar.valorPago},${schema.contaPagar.valor}))`))
    .limit(10);

  // --- Faturamento por canal de origem (rótulo amigável: iFood/MenuDino) ---
  const porCanalRaw = await db
    .select({
      origem: schema.pedido.codigoPedidoOrigem,
      faturamento: sql<string>`coalesce(sum(${schema.pedido.valorTotal}),0)`,
      pedidos: sql<number>`count(*)::int`,
    })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        isNull(schema.pedido.dataDelete),
        gte(schema.pedido.dataFechamento, tsStart),
        lte(schema.pedido.dataFechamento, tsEnd),
      ),
    )
    .groupBy(schema.pedido.codigoPedidoOrigem);
  // 4/7 (iFood, DeliveryHub) = iFood; 5/6 = MenuDino. Funde os duplicados.
  const CANAL_LABEL: Record<number, string> = {
    1: 'Desktop', 2: 'Comanda Mobile', 3: 'Cardápio Digital', 4: 'iFood Online',
    5: 'MenuDino', 6: 'MenuDino', 7: 'iFood Online', 8: 'Totem',
  };
  const canalAgg = new Map<string, { faturamento: number; pedidos: number }>();
  for (const c of porCanalRaw) {
    const label = c.origem != null ? CANAL_LABEL[c.origem] ?? `Origem ${c.origem}` : '(sem origem)';
    const cur = canalAgg.get(label) ?? { faturamento: 0, pedidos: 0 };
    cur.faturamento += num(c.faturamento);
    cur.pedidos += c.pedidos;
    canalAgg.set(label, cur);
  }
  const porCanal = [...canalAgg.entries()]
    .map(([canal, v]) => ({ canal, faturamento: v.faturamento, pedidos: v.pedidos }))
    .sort((a, b) => b.faturamento - a.faturamento);

  // --- Faturamento por dia da semana (BRT: 0=Dom..6=Sáb) ---
  const dow = await db
    .select({
      dia: sql<number>`extract(dow from (${schema.pedido.dataFechamento} at time zone 'America/Sao_Paulo'))::int`,
      faturamento: sql<string>`coalesce(sum(${schema.pedido.valorTotal}),0)`,
    })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        isNull(schema.pedido.dataDelete),
        gte(schema.pedido.dataFechamento, tsStart),
        lte(schema.pedido.dataFechamento, tsEnd),
      ),
    )
    .groupBy(sql`1`);

  // --- Custo de ocupação (aluguel/energia/água/gás/internet/condomínio) pago no mês ---
  const [ocup] = await db
    .select({ total: sql<string>`coalesce(sum(coalesce(${schema.contaPagar.valorPago},${schema.contaPagar.valor})),0)` })
    .from(schema.contaPagar)
    .leftJoin(schema.categoriaConta, eq(schema.categoriaConta.id, schema.contaPagar.categoriaId))
    .where(
      and(
        eq(schema.contaPagar.filialId, filialId),
        isNull(schema.contaPagar.borderoId),
        isNotNull(schema.contaPagar.dataPagamento),
        gte(schema.contaPagar.dataPagamento, ymdStart),
        lte(schema.contaPagar.dataPagamento, ymdEnd),
        sql`${schema.categoriaConta.descricao} ~* 'aluguel|energia|agua|água|g[áa]s|internet|condom'`,
      ),
    );

  // --- Cobertura / conciliação (até quando vai cada fonte) ---
  const [extr] = await db
    .select({ ate: sql<string | null>`max(${schema.lancamentoBanco.dataMovimento})::text` })
    .from(schema.lancamentoBanco)
    .where(eq(schema.lancamentoBanco.filialId, filialId));
  const [vadq] = await db
    .select({ ate: sql<string | null>`max(${schema.vendaAdquirente.dataVenda})::text` })
    .from(schema.vendaAdquirente)
    .where(eq(schema.vendaAdquirente.filialId, filialId));
  const [radq] = await db
    .select({ ate: sql<string | null>`max(${schema.recebivelAdquirente.dataPagamento})::text` })
    .from(schema.recebivelAdquirente)
    .where(eq(schema.recebivelAdquirente.filialId, filialId));
  const [conc] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completo: sql<number>`count(*) filter (where ${schema.conciliacaoPagamento.etapa} = 'COMPLETO')::int`,
    })
    .from(schema.pagamento)
    .leftJoin(schema.conciliacaoPagamento, eq(schema.conciliacaoPagamento.pagamentoId, schema.pagamento.id))
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        gte(schema.pagamento.dataPagamento, tsStart),
        lte(schema.pagamento.dataPagamento, tsEnd),
      ),
    );

  const faturamento = num(vendas.faturamento);
  const pedidos = vendas.pedidos;
  const despesasPagas = num(despPagas.total);
  const entradasBanco = bancoContas.reduce((s, c) => s + num(c.entradas), 0);
  const saidasBanco = bancoContas.reduce((s, c) => s + num(c.saidas), 0);

  return {
    periodo: { ano, mes, ymdStart, ymdEnd },
    vendas: {
      faturamento,
      faturamentoLiquido: faturamento - num(vendas.descontos),
      pedidos,
      // cancelado no mes = excluido logo depois de fechado (PDV) + o que o caixa da loja cancelou
      cancelados: canc.q + cancCaixa.pedidos,
      valorCancelado: num(canc.valor) + num(cancCaixa.valor),
      canceladoCaixa: { linhas: cancCaixa.q, pedidosInteiros: cancCaixa.pedidos, valor: num(cancCaixa.valor) },
      ticketMedio: pedidos ? faturamento / pedidos : 0,
      pessoas: vendas.pessoas,
      descontos: num(vendas.descontos),
      acrescimos: num(vendas.acrescimos),
      servico: num(vendas.servico),
      itensPorPedido: pedidos ? itens.total / pedidos : 0,
      custoOcupacao: num(ocup.total),
    },
    canais: porCanal,
    diaSemana: dow.map((x) => ({ dia: x.dia, faturamento: num(x.faturamento) })),
    formas: formasArr,
    topProdutos: topProdutos.map((p) => ({ nome: p.nome || '—', valor: num(p.valor), qtd: num(p.qtd) })),
    banco: {
      contas: bancoContas.map((c) => ({
        nome: c.apelido || c.banco || '—',
        entradas: num(c.entradas),
        saidas: num(c.saidas),
      })),
      entradas: entradasBanco,
      saidas: saidasBanco,
      saldo: entradasBanco - saidasBanco,
    },
    despesas: {
      pagas: despesasPagas,
      qtdPagas: despPagas.q,
      aVencer: num(despAbertas.total),
      qtdAVencer: despAbertas.q,
      topFornecedores: topFornecedores.map((f) => ({ nome: f.nome || '(sem fornecedor)', total: num(f.total) })),
      porCategoria: porCategoria.map((c) => ({ categoria: c.categoria || '(sem categoria)', total: num(c.total) })),
    },
    resultado: {
      receitas: faturamento,
      despesas: despesasPagas,
      lucro: faturamento - despesasPagas,
      margem: faturamento ? ((faturamento - despesasPagas) / faturamento) * 100 : 0,
    },
    // Competência: tudo o que vence no mês, pago ou em aberto (ver a consulta acima).
    resultadoTudoPago: (() => {
      const pagas = num(tp?.pagas ?? null);
      const aberto = num(tp?.aberto ?? null);
      const despesas = pagas + aberto;
      return {
        receitas: faturamento,
        pagas,
        qtdPagas: tp?.qtd_pagas ?? 0,
        pagasFora: num(tp?.pagas_fora ?? null),
        aberto,
        qtdAberto: tp?.qtd_aberto ?? 0,
        provisoesAbertas: num(tp?.provisoes_abertas ?? null),
        qtdProvisoesAbertas: tp?.qtd_provisoes_abertas ?? 0,
        provisoesCobertas: num(tp?.provisoes_cobertas ?? null),
        qtdProvisoesCobertas: tp?.qtd_provisoes_cobertas ?? 0,
        encontro: num(tp?.encontro ?? null),
        qtdEncontro: tp?.qtd_encontro ?? 0,
        excluidasPagas: num(ponte?.excluidas ?? null),
        outrosMeses: num(ponte?.outros_meses ?? null),
        encontroPago: num(ponte?.encontro_pago ?? null),
        despesas,
        lucro: faturamento - despesas,
        margem: faturamento ? ((faturamento - despesas) / faturamento) * 100 : 0,
        // Sobrou ou faltou (caixa do mês × conta que ficou sem pagar)
        pagoNoMes: num(cx?.pago_no_mes ?? null),
        pagoDeMesesAnteriores: num(cx?.de_meses_anteriores ?? null),
        pagoAdiantado: num(cx?.adiantadas ?? null),
        pagasDepois: num(cx?.pagas_depois ?? null),
        encontroPagoNoMes: num(cx?.encontro_no_mes ?? null),
        // em aberto que ainda não venceu (só existe no mês em andamento)
        abertoAVencer: num(tp?.aberto_a_vencer ?? null),
        sobraCaixa: faturamento - num(cx?.pago_no_mes ?? null),
        naoPagoNoMes: aberto + num(tp?.pagas_fora ?? null),
        sobraReal: faturamento - num(cx?.pago_no_mes ?? null) - aberto - num(tp?.pagas_fora ?? null),
      };
    })(),
    cobertura: {
      extratoAte: extr?.ate ?? null,
      vendaCartaoAte: vadq?.ate ?? null,
      recebivelCartaoAte: radq?.ate ?? null,
      concTotal: conc?.total ?? 0,
      concCompleto: conc?.completo ?? 0,
      concPct: conc?.total ? (conc.completo / conc.total) * 100 : 0,
    },
  };
}
