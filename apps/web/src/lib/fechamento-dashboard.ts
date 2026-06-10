// Agregacoes do Dashboard de Fechamento de Mes (por filial).
// Cruza vendas (pedido/pagamento) + extrato bancario (lancamento_banco) +
// despesas/fornecedores (conta_pagar). Datas em BRT (ver lib/datas).

import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import { brDateStart, brDateEnd } from './datas';

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
    .select({ q: sql<number>`count(*)::int` })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.filialId, filialId),
        isNotNull(schema.pedido.dataDelete),
        gte(schema.pedido.dataFechamento, tsStart),
        lte(schema.pedido.dataFechamento, tsEnd),
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

  const formas = await db
    .select({
      forma: schema.pagamento.formaPagamento,
      total: sql<string>`coalesce(sum(${schema.pagamento.valor}),0)`,
      qtd: sql<number>`count(*)::int`,
    })
    .from(schema.pagamento)
    .where(
      and(
        eq(schema.pagamento.filialId, filialId),
        gte(schema.pagamento.dataPagamento, tsStart),
        lte(schema.pagamento.dataPagamento, tsEnd),
      ),
    )
    .groupBy(schema.pagamento.formaPagamento)
    .orderBy(desc(sql`sum(${schema.pagamento.valor})`));

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
        isNull(schema.contaPagar.dataPagamento),
        gte(schema.contaPagar.dataVencimento, ymdStart),
        lte(schema.contaPagar.dataVencimento, ymdEnd),
      ),
    );

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
        isNotNull(schema.contaPagar.dataPagamento),
        gte(schema.contaPagar.dataPagamento, ymdStart),
        lte(schema.contaPagar.dataPagamento, ymdEnd),
      ),
    )
    .groupBy(schema.categoriaConta.descricao)
    .orderBy(desc(sql`sum(coalesce(${schema.contaPagar.valorPago},${schema.contaPagar.valor}))`))
    .limit(10);

  const faturamento = num(vendas.faturamento);
  const pedidos = vendas.pedidos;
  const despesasPagas = num(despPagas.total);
  const entradasBanco = bancoContas.reduce((s, c) => s + num(c.entradas), 0);
  const saidasBanco = bancoContas.reduce((s, c) => s + num(c.saidas), 0);

  return {
    periodo: { ano, mes, ymdStart, ymdEnd },
    vendas: {
      faturamento,
      pedidos,
      cancelados: canc.q,
      ticketMedio: pedidos ? faturamento / pedidos : 0,
      pessoas: vendas.pessoas,
      descontos: num(vendas.descontos),
      servico: num(vendas.servico),
      itensPorPedido: pedidos ? itens.total / pedidos : 0,
    },
    formas: formas.map((f) => ({ forma: f.forma || '—', total: num(f.total), qtd: f.qtd })),
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
  };
}
