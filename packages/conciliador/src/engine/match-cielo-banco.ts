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

export interface MatchCieloBancoOpts {
  /** Janela de dias (±) em torno da data prevista pra procurar o credito no banco.
   * Banco nao credita sab/dom/feriado — valor esperado cai 2-4 dias depois. Default 4. */
  janelaDias?: number;
}

function addDias(iso: string, n: number): string {
  // dd/mm/yyyy input
  const [d, m, y] = iso.split('/');
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  dt.setDate(dt.getDate() + n);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

export function matchCieloBanco(
  recebiveis: RecebivelInput[],
  lancamentos: LancamentoBancoInput[],
  opts: MatchCieloBancoOpts = {},
): MatchCieloBancoResult {
  const janela = Math.max(0, opts.janelaDias ?? 4);
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

  // Set global de creditos ja consumidos por algum grupo
  const usados = new Set<LancamentoBancoInput>();

  // Processa grupos em ordem CRONOLOGICA real (nao lexicografica sobre
  // DD/MM/YYYY que daria 01/01 -> 01/02 -> 01/03 -> 02/01). Converte pra
  // YYYY-MM-DD antes de ordenar.
  function keyCronologica(k: string): string {
    const [dataBr] = k.split('|');
    const [d, m, y] = dataBr!.split('/');
    return `${y}-${m}-${d}`;
  }
  const grupos = [...recPorGrupo.entries()].sort(
    ([a], [b]) => keyCronologica(a).localeCompare(keyCronologica(b)),
  );

  // Processa em multiplos passes expandindo a janela gradualmente. Isso evita
  // que grupo A com crédito no dia exato D seja preterido porque grupo B (de
  // D-3) ja consumiu o crédito de D via subset maior. Garante que matches
  // "mais proximos" da data original tenham prioridade.
  const restantes = [...grupos];
  for (let janelaAtual = 0; janelaAtual <= janela; janelaAtual++) {
    const sobram: typeof restantes = [];
    for (const [key, items] of restantes) {
      const [dataPagamento, tipo] = key.split('|') as [string, 'PIX' | 'CARTAO'];
      const totalLiq = +items.reduce((s, r) => s + r.valorLiquido, 0).toFixed(2);

      // Candidatos: janela atual (0, ±1, ±2... ±janelaAtual)
      const ordem: number[] = [0];
      for (let d = 1; d <= janelaAtual; d++) {
        ordem.push(d);
        ordem.push(-d);
      }
      const candidatos: LancamentoBancoInput[] = [];
      for (const delta of ordem) {
        const dia = addDias(dataPagamento, delta);
        const arr = credByDia.get(dia) ?? [];
        for (const c of arr) if (!usados.has(c)) candidatos.push(c);
      }

      const valores = candidatos.map((c) => c.valor);
      const idxs = subsetSum(valores, totalLiq);
      if (idxs && idxs.length) {
        items.forEach((it) => nsusPagos.add(it.nsu));
        const consumidos = idxs.map((i) => candidatos[i]!);
        consumidos.forEach((u) => usados.add(u));
        gruposCompletos.push({
          dataPagamento,
          tipo,
          qtdRecebiveis: items.length,
          valorTotal: totalLiq,
          lancamentosBanco: consumidos,
        });
      } else {
        sobram.push([key, items]);
      }
    }
    restantes.length = 0;
    restantes.push(...sobram);
  }
  // O que nao achou match ate a janela maxima
  for (const [key, items] of restantes) {
    const [dataPagamento, tipo] = key.split('|') as [string, 'PIX' | 'CARTAO'];
    const totalLiq = +items.reduce((s, r) => s + r.valorLiquido, 0).toFixed(2);
    gruposSemMatch.push({
      dataPagamento,
      tipo,
      qtdRecebiveis: items.length,
      valorTotal: totalLiq,
    });
  }

  const creditosSobrando: LancamentoBancoInput[] = [];
  for (const arr of credByDia.values()) {
    for (const c of arr) if (!usados.has(c)) creditosSobrando.push(c);
  }

  return { nsusPagos, gruposCompletos, gruposSemMatch, creditosSobrando };
}
