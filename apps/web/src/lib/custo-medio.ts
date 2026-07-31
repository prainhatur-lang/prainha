// Custeio por Média Ponderada Móvel (MPM).
// Padrão de mercado em estoque de restaurante / varejo. A cada entrada,
// o custo do produto é recalculado como média ponderada do que já
// estava no estoque + a nova entrada.
//
// Fórmula:
//   novoCusto = (saldoAtual × custoAtual + qtdEntrada × custoEntrada)
//             / (saldoAtual + qtdEntrada)
//
// Casos limite:
//   - saldo atual <= 0  → novoCusto = custoEntrada (não tem o que ponderar)
//   - qtdEntrada <= 0   → novoCusto = custoAtual (entrada inválida)
//   - novoSaldo <= 0    → mantém custoAtual (evita div/0)
//
// Saídas (vendas, baixa de ficha, transformação) NÃO mudam o custo médio
// — só consomem ao custo médio vigente.

import { db, schema } from '@concilia/db';
import { eq, sql } from 'drizzle-orm';

export interface ResultadoMpm {
  produtoId: string;
  saldoAnterior: number;
  custoAnterior: number;
  qtdEntrada: number;
  custoEntrada: number;
  saldoNovo: number;
  custoNovo: number;
}

/** Calcula MPM sem persistir. Útil pra previsão na UI. */
export function calcularMpm(opts: {
  saldoAtual: number;
  custoAtual: number;
  qtdEntrada: number;
  custoEntrada: number;
}): { saldoNovo: number; custoNovo: number } {
  const { saldoAtual, custoAtual, qtdEntrada, custoEntrada } = opts;
  const saldoNovo = saldoAtual + qtdEntrada;

  if (qtdEntrada <= 0) return { saldoNovo, custoNovo: custoAtual };
  if (saldoAtual <= 0) return { saldoNovo, custoNovo: custoEntrada };
  if (saldoNovo <= 0) return { saldoNovo, custoNovo: custoAtual };

  const custoNovo =
    (saldoAtual * custoAtual + qtdEntrada * custoEntrada) / saldoNovo;
  return { saldoNovo, custoNovo };
}

/** Aplica MPM no produto: lê estoqueAtual e precoCusto, calcula novo
 *  custo ponderado e atualiza ambos atomicamente.
 *
 *  Importante: o saldo é atualizado pelo valor da entrada (qtdEntrada),
 *  e o precoCusto recebe o MPM. Caller deve chamar isso DEPOIS de
 *  inserir o movimento_estoque (pra preservar ordem cronológica).
 */
export async function aplicarMpmEntrada(opts: {
  produtoId: string;
  qtdEntrada: number;
  custoEntrada: number;
}): Promise<ResultadoMpm> {
  const [prod] = await db
    .select({
      id: schema.produto.id,
      estoqueAtual: schema.produto.estoqueAtual,
      precoCusto: schema.produto.precoCusto,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, opts.produtoId))
    .limit(1);

  if (!prod) throw new Error(`produto ${opts.produtoId} nao encontrado`);

  const saldoAtual = Number(prod.estoqueAtual ?? 0);
  const custoAtual = Number(prod.precoCusto ?? 0);
  const { saldoNovo, custoNovo } = calcularMpm({
    saldoAtual,
    custoAtual,
    qtdEntrada: opts.qtdEntrada,
    custoEntrada: opts.custoEntrada,
  });

  await db
    .update(schema.produto)
    .set({
      estoqueAtual: saldoNovo.toFixed(4),
      precoCusto: custoNovo.toFixed(4),
    })
    .where(eq(schema.produto.id, opts.produtoId));

  return {
    produtoId: opts.produtoId,
    saldoAnterior: saldoAtual,
    custoAnterior: custoAtual,
    qtdEntrada: opts.qtdEntrada,
    custoEntrada: opts.custoEntrada,
    saldoNovo,
    custoNovo,
  };
}

/** Aplica saída no produto: só decrementa o saldo. Custo não muda
 *  (saída sempre usa custo médio vigente). */
export async function aplicarSaida(opts: {
  produtoId: string;
  qtdSaida: number;
}): Promise<{ saldoNovo: number; custoUnitarioNoMomento: number }> {
  const [prod] = await db
    .select({
      estoqueAtual: schema.produto.estoqueAtual,
      precoCusto: schema.produto.precoCusto,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, opts.produtoId))
    .limit(1);

  if (!prod) throw new Error(`produto ${opts.produtoId} nao encontrado`);

  const saldoAtual = Number(prod.estoqueAtual ?? 0);
  const custoUnit = Number(prod.precoCusto ?? 0);
  const saldoNovo = saldoAtual - opts.qtdSaida;

  await db
    .update(schema.produto)
    .set({
      estoqueAtual: sql`COALESCE(${schema.produto.estoqueAtual}, 0) - ${opts.qtdSaida.toFixed(4)}`,
    })
    .where(eq(schema.produto.id, opts.produtoId));

  return { saldoNovo, custoUnitarioNoMomento: custoUnit };
}

/** Calcula o fator de rateio de frete/despesas/desconto para itens da NFe.
 *  Multiplica esse fator pelo valor do item pra obter o "custo total real"
 *  considerando todas as despesas adicionais.
 *
 *  Fórmula: valorTotal / valorProdutos
 *  Onde:
 *    valorTotal = soma de tudo (vNF) ≈ produtos + frete + seguro + outros - desconto
 *    valorProdutos = soma só dos produtos (vProd)
 *
 *  Default 1 se valorProdutos = 0 ou null (sem rateio aplicado). */
export function fatorRateioNfe(opts: {
  valorTotal: string | number | null | undefined;
  valorProdutos: string | number | null | undefined;
}): number {
  const total = Number(opts.valorTotal ?? 0);
  const produtos = Number(opts.valorProdutos ?? 0);
  if (produtos <= 0) return 1;
  if (total <= 0) return 1;
  return total / produtos;
}
