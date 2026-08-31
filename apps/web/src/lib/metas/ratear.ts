// Rateio da premiação entre a equipe, proporcional a minutos trabalhados no
// período. Função pura — mesma disciplina de lib/folha/calcular.ts.
//
// Diferença do rateio de comissão (calcular.ts:114-137): aqui é 1 bucket
// pro período inteiro (não por dia), e a soma PRECISA fechar exatamente
// premiacaoTotal — a sobra de arredondamento vai pra pessoa com mais
// minutos (maior fatia é onde 1 centavo a mais/menos importa menos).

import type { PessoaMinutos } from './horas-periodo';

export interface RateioLinha {
  fornecedorId: string;
  nome: string;
  minutos: number;
  valor: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Rateia premiacaoTotal entre quem trabalhou (minutos>0) no período,
 *  proporcional a minutos. Retorna [] se ninguém trabalhou ou premiação<=0. */
export function ratearPremiacao(pessoas: PessoaMinutos[], premiacaoTotal: number): RateioLinha[] {
  const comMinutos = pessoas.filter((p) => p.minutos > 0);
  const totalMinutos = comMinutos.reduce((s, p) => s + p.minutos, 0);
  if (totalMinutos === 0 || premiacaoTotal <= 0) return [];

  const linhas: RateioLinha[] = comMinutos.map((p) => ({
    fornecedorId: p.fornecedorId,
    nome: p.nome,
    minutos: p.minutos,
    valor: round2((p.minutos / totalMinutos) * premiacaoTotal),
  }));

  // Corrige a sobra de arredondamento na maior fatia — a soma precisa
  // fechar EXATAMENTE premiacaoTotal (diferente do rateio de comissão, que
  // tolera a divergência natural do 10%).
  const somaArredondada = linhas.reduce((s, l) => s + l.valor, 0);
  const diferenca = round2(premiacaoTotal - somaArredondada);
  if (diferenca !== 0) {
    const maior = linhas.reduce((a, b) => (b.minutos > a.minutos ? b : a));
    maior.valor = round2(maior.valor + diferenca);
  }

  return linhas;
}
