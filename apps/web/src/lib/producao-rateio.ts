// Rateio do custo das entradas de uma OP pelas saídas PRODUTO.
// Usado na tela (prévia) e na conclusão (/api/ordem-producao/[id]/concluir),
// pra os dois darem o mesmo número.
//
// Modo PESO: quando TODA saída útil tem peso em kg (unidade kg/g, ou o
// "Peso (kg)" pesado na balança pra un/l/ml), o custo se divide por
// kg × pesoRelativo. Ex.: 44 kg de filé → 93 robalos (23,25 kg) + 20 iscas
// (6 kg) + 5,381 kg de apara: cada kg útil carrega o mesmo custo.
//
// Modo QUANTIDADE (como sempre foi): falta peso em alguma saída útil →
// divide por qtd × pesoRelativo. Só faz sentido com todas na mesma unidade;
// misturar kg com un sem peso dá custo errado (avisa via `misturaUnidade`).
//
// Perdas não entram no denominador: o custo delas fica nos produtos.

export interface SaidaParaRateio {
  tipo: string;
  quantidade: number;
  unidade: string | null;
  pesoTotalKg: number | null;
  pesoRelativo: number;
}

export interface ResultadoRateio {
  modo: 'peso' | 'quantidade';
  /** custo unitário (na unidade do produto) de cada saída, na mesma ordem */
  custoUnit: number[];
  /** modo peso: custo por kg com pesoRelativo 1; modo qtd: custo por unidade-peso */
  custoPorBase: number;
  /** saídas úteis em unidades diferentes e sem peso pra todas */
  misturaUnidade: boolean;
}

export function kgDaSaida(s: { quantidade: number; unidade: string | null; pesoTotalKg: number | null }): number {
  const u = (s.unidade ?? '').toLowerCase();
  if (u === 'kg') return s.quantidade;
  if (u === 'g') return s.quantidade / 1000;
  return s.pesoTotalKg && s.pesoTotalKg > 0 ? s.pesoTotalKg : NaN;
}

export function ratearCustoOp(custoTotal: number, saidas: SaidaParaRateio[]): ResultadoRateio {
  const uteis = saidas.map((s, i) => ({ s, i })).filter(({ s }) => s.tipo === 'PRODUTO');
  const kgs = uteis.map(({ s }) => kgDaSaida(s));
  const modo: 'peso' | 'quantidade' =
    uteis.length > 0 && kgs.every((k) => Number.isFinite(k) && k > 0) ? 'peso' : 'quantidade';

  const custoUnit = saidas.map(() => 0);
  let custoPorBase = 0;

  if (modo === 'peso') {
    const base = uteis.map(({ s }, j) => kgs[j]! * s.pesoRelativo);
    const soma = base.reduce((a, b) => a + b, 0);
    custoPorBase = soma > 0 ? custoTotal / soma : 0;
    uteis.forEach(({ s, i }, j) => {
      custoUnit[i] = s.quantidade > 0 ? (base[j]! * custoPorBase) / s.quantidade : 0;
    });
  } else {
    const soma = uteis.reduce((a, { s }) => a + s.quantidade * s.pesoRelativo, 0);
    custoPorBase = soma > 0 ? custoTotal / soma : 0;
    uteis.forEach(({ s, i }) => {
      custoUnit[i] = s.pesoRelativo * custoPorBase;
    });
  }

  const unidades = new Set(uteis.map(({ s }) => (s.unidade ?? '').toLowerCase()));
  return { modo, custoUnit, custoPorBase, misturaUnidade: modo === 'quantidade' && unidades.size > 1 };
}
