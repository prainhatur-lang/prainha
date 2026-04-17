// Conciliacao 1: PDV (Consumer.PAGAMENTOS) <-> Vendas Cielo
// Match por NSU. Reporta valores divergentes.

export interface PdvPagamento {
  id: string;
  nsu: string | null;
  valor: number;
  formaPagamento: string;
}

export interface CieloVenda {
  id?: string;
  nsu: string;
  valorBruto: number;
}

export interface MatchPdvCieloResult {
  matched: Array<{
    pdv: PdvPagamento;
    cielo: CieloVenda;
    diff: number;
  }>;
  divergenciaValor: Array<{ pdv: PdvPagamento; cielo: CieloVenda; diff: number }>;
  pdvSemCielo: PdvPagamento[];
  cieloSemPdv: CieloVenda[];
}

const TOL = 0.01;

export function matchPdvCielo(
  pagamentos: PdvPagamento[],
  vendas: CieloVenda[],
): MatchPdvCieloResult {
  const cieloByNsu = new Map<string, CieloVenda>();
  for (const v of vendas) cieloByNsu.set(v.nsu, v);

  const result: MatchPdvCieloResult = {
    matched: [],
    divergenciaValor: [],
    pdvSemCielo: [],
    cieloSemPdv: [],
  };
  const cieloUsed = new Set<string>();

  for (const p of pagamentos) {
    if (!p.nsu) continue;
    const c = cieloByNsu.get(p.nsu);
    if (!c) {
      result.pdvSemCielo.push(p);
      continue;
    }
    cieloUsed.add(c.nsu);
    const diff = +(c.valorBruto - p.valor).toFixed(2);
    if (Math.abs(diff) < TOL) result.matched.push({ pdv: p, cielo: c, diff });
    else result.divergenciaValor.push({ pdv: p, cielo: c, diff });
  }

  for (const v of vendas) {
    if (!cieloUsed.has(v.nsu)) result.cieloSemPdv.push(v);
  }

  return result;
}
