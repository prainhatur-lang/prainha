// Conciliacao 2: Recebiveis Cielo <-> Lancamentos do banco
// Match por (data, soma de creditos). Usa subset sum para encontrar
// combinacoes de PIX que somam o total Cielo do dia.

import { subsetSum } from './subset-sum';

export interface RecebivelInput {
  id?: string;
  nsu: string;
  dataPagamento: string; // dd/mm/yyyy
  formaPagamento: string;
  valorLiquido: number;
}

export interface LancamentoBancoInput {
  id?: string;
  dataMovimento: string; // dd/mm/yyyy
  tipo: 'C' | 'D';
  valor: number;
  descricao: string;
  idTransacao: string;
}

export interface MatchCieloBancoResult {
  /** NSUs que foram efetivamente pagos no banco */
  nsusPagos: Set<string>;
  /** Grupos (dia, tipo) que bateram com creditos do banco */
  gruposCompletos: Array<{
    dataPagamento: string;
    tipo: 'PIX' | 'CARTAO';
    qtdRecebiveis: number;
    valorTotal: number;
    lancamentosBanco: LancamentoBancoInput[];
  }>;
  /** Grupos que nao acharam credito correspondente */
  gruposSemMatch: Array<{
    dataPagamento: string;
    tipo: 'PIX' | 'CARTAO';
    qtdRecebiveis: number;
    valorTotal: number;
  }>;
  /** Creditos do banco que nao foram consumidos por nenhum grupo */
  creditosSobrando: LancamentoBancoInput[];
}

/** Tipos de descricao do banco que sao candidatos a creditos da Cielo */
const DESCRICOES_CREDITOS_ADQUIRENTE = [
  'PIX RECEBIDO',
  'RECEBIMENTO VENDAS DE CAR',
  'TED RECEBIDA',
];

export function matchCieloBanco(
  recebiveis: RecebivelInput[],
  lancamentos: LancamentoBancoInput[],
): MatchCieloBancoResult {
  const nsusPagos = new Set<string>();
  const gruposCompletos: MatchCieloBancoResult['gruposCompletos'] = [];
  const gruposSemMatch: MatchCieloBancoResult['gruposSemMatch'] = [];

  // Agrupa recebiveis por (dia, tipo PIX/CARTAO)
  const recPorGrupo = new Map<string, RecebivelInput[]>();
  for (const r of recebiveis) {
    const tipo = r.formaPagamento === 'Pix' ? 'PIX' : 'CARTAO';
    const key = `${r.dataPagamento}|${tipo}`;
    const arr = recPorGrupo.get(key) ?? [];
    arr.push(r);
    recPorGrupo.set(key, arr);
  }

  // Indexa creditos do banco por dia (apenas tipo C com descricoes esperadas)
  const credByDia = new Map<string, LancamentoBancoInput[]>();
  for (const l of lancamentos) {
    if (l.tipo !== 'C') continue;
    const ehCandidato = DESCRICOES_CREDITOS_ADQUIRENTE.some((d) => l.descricao.startsWith(d));
    if (!ehCandidato) continue;
    const arr = credByDia.get(l.dataMovimento) ?? [];
    arr.push(l);
    credByDia.set(l.dataMovimento, arr);
  }

  for (const [key, items] of recPorGrupo) {
    const [dataPagamento, tipo] = key.split('|') as [string, 'PIX' | 'CARTAO'];
    const totalLiq = +items.reduce((s, r) => s + r.valorLiquido, 0).toFixed(2);
    const cands = credByDia.get(dataPagamento) ?? [];
    const valores = cands.map((c) => c.valor);

    const idxs = subsetSum(valores, totalLiq);
    if (idxs && idxs.length) {
      items.forEach((it) => nsusPagos.add(it.nsu));
      const usados = idxs.map((i) => cands[i]!);
      // Remove os usados desse dia
      const restante = (credByDia.get(dataPagamento) ?? []).filter((c) => !usados.includes(c));
      credByDia.set(dataPagamento, restante);
      gruposCompletos.push({
        dataPagamento,
        tipo,
        qtdRecebiveis: items.length,
        valorTotal: totalLiq,
        lancamentosBanco: usados,
      });
    } else {
      gruposSemMatch.push({
        dataPagamento,
        tipo,
        qtdRecebiveis: items.length,
        valorTotal: totalLiq,
      });
    }
  }

  const creditosSobrando = [...credByDia.values()].flat();

  return { nsusPagos, gruposCompletos, gruposSemMatch, creditosSobrando };
}
