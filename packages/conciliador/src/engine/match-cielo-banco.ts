// Conciliacao 2: Recebiveis Cielo <-> Lancamentos do banco
// Match por (data, soma de creditos). Usa subset sum para encontrar
// combinacoes de PIX que somam o total Cielo do dia.

import { subsetSum, subsetSumMulti } from './subset-sum';

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
  // Helper: coleta candidatos pra um grupo numa janela de N dias,
  // opcionalmente ignorando "usados" (pra tentar realocacao).
  function coletaCandidatos(
    dataPagamento: string,
    ignorarUsados = false,
    janelaCustom: number | null = null,
  ): LancamentoBancoInput[] {
    const j = janelaCustom ?? janela;
    const ordem: number[] = [0];
    for (let d = 1; d <= j; d++) {
      ordem.push(d);
      ordem.push(-d);
    }
    const out: LancamentoBancoInput[] = [];
    for (let i = 0; i < ordem.length; i++) {
      const delta = ordem[i]!;
      const dia = addDias(dataPagamento, delta);
      const arr = credByDia.get(dia) ?? [];
      for (const c of arr) {
        if (ignorarUsados || !usados.has(c)) out.push(c);
      }
    }
    return out;
  }
  // Janela maior pro pass 3: permite encontrar subsets que Cielo eventualmente
  // pagou em datas mais distantes (feriados prolongados, atrasos).
  const janelaReloc = Math.min(janela + 3, 7);

  // --- Pass 3: Re-alocacao pra grupos restantes ---
  // Pra cada grupo pendente, tenta ate 10 subsets candidatos. Se o 1o nao
  // permite realocar os grupos "roubados", tenta o 2o, 3o, etc.
  for (let iter = 0; iter < 5 && restantes.length > 0; iter++) {
    const sobram: typeof restantes = [];
    for (const [key, items] of restantes) {
      const [dataPagamento] = key.split('|') as [string, 'PIX' | 'CARTAO'];
      const totalLiq = +items.reduce((s, r) => s + r.valorLiquido, 0).toFixed(2);

      const todos = coletaCandidatos(dataPagamento, true, janelaReloc);
      const valoresTodos = todos.map((c) => c.valor);
      const subsets = subsetSumMulti(valoresTodos, totalLiq, 0.05, 10);
      if (subsets.length === 0) {
        sobram.push([key, items]);
        continue;
      }

      let aplicou = false;
      for (const idxs of subsets) {
        if (aplicou) break;
        const desejados = new Set(idxs.map((i) => todos[i]!));
        const roubados = [...desejados].filter((c) => usados.has(c));

        if (roubados.length === 0) {
          // sem conflito — so aloca
          desejados.forEach((c) => usados.add(c));
          gruposCompletos.push({
            dataPagamento,
            tipo: key.split('|')[1] as 'PIX' | 'CARTAO',
            qtdRecebiveis: items.length,
            valorTotal: totalLiq,
            lancamentosBanco: [...desejados],
          });
          items.forEach((it) => nsusPagos.add(it.nsu));
          aplicou = true;
          break;
        }

        // Identifica grupos afetados pelo roubo
        type Afetado = { grupoIdx: number; perdidos: Set<LancamentoBancoInput> };
        const afetados = new Map<number, Afetado>();
        for (const c of roubados) {
          const idx = gruposCompletos.findIndex((g) => g.lancamentosBanco.includes(c));
          if (idx < 0) continue;
          const existente = afetados.get(idx);
          if (existente) existente.perdidos.add(c);
          else afetados.set(idx, { grupoIdx: idx, perdidos: new Set([c]) });
        }

        // Tenta re-alocar cada grupo afetado sem os creditos roubados
        const planoRealocacao: Array<{
          grupoIdx: number;
          novosCreditos: LancamentoBancoInput[];
          creditosAntigos: LancamentoBancoInput[];
        }> = [];
        let podeRealocar = true;
        const roubadosSet = new Set(roubados);
        for (const [grupoIdx, { perdidos }] of afetados) {
          const grupoAfetado = gruposCompletos[grupoIdx]!;
          const naJanela = coletaCandidatos(grupoAfetado.dataPagamento, true, janelaReloc);
          const disponiveis = naJanela.filter((c) => {
            if (roubadosSet.has(c)) return false;
            if (!usados.has(c)) return true;
            return grupoAfetado.lancamentosBanco.includes(c) && !perdidos.has(c);
          });
          const valoresDisp = disponiveis.map((c) => c.valor);
          const novoIdxs = subsetSum(valoresDisp, grupoAfetado.valorTotal);
          if (!novoIdxs || !novoIdxs.length) {
            podeRealocar = false;
            break;
          }
          planoRealocacao.push({
            grupoIdx,
            novosCreditos: novoIdxs.map((i) => disponiveis[i]!),
            creditosAntigos: grupoAfetado.lancamentosBanco,
          });
        }

        if (!podeRealocar) continue; // tenta proximo subset

        // Aplica re-alocacao
        for (const p of planoRealocacao) {
          p.creditosAntigos.forEach((c) => usados.delete(c));
          p.novosCreditos.forEach((c) => usados.add(c));
          gruposCompletos[p.grupoIdx]!.lancamentosBanco = p.novosCreditos;
        }
        desejados.forEach((c) => usados.add(c));
        gruposCompletos.push({
          dataPagamento,
          tipo: key.split('|')[1] as 'PIX' | 'CARTAO',
          qtdRecebiveis: items.length,
          valorTotal: totalLiq,
          lancamentosBanco: [...desejados],
        });
        items.forEach((it) => nsusPagos.add(it.nsu));
        aplicou = true;
      }

      if (!aplicou) sobram.push([key, items]);
    }
    restantes.length = 0;
    restantes.push(...sobram);
  }

  // O que nao achou match mesmo apos re-alocacao
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
