// Conciliacao 1: PDV (Consumer.PAGAMENTOS) <-> Vendas Cielo
// Match por NSU (primary) + fallback por (data, valor, forma).
// Reporta valores divergentes.

export interface PdvPagamento {
  id: string;
  nsu: string | null;
  valor: number;
  formaPagamento: string;
  /** ISO yyyy-mm-dd — usado no fallback data+valor */
  dataPagamento?: string;
  /** Numero do pedido (Consumer.CODIGOPEDIDO). Aparece na descricao da excecao. */
  codigoPedidoExterno?: number | null;
  /** Codigo de autorizacao do cartao — junto com NSU forma chave unica por transacao */
  numeroAutorizacao?: string | null;
}

export interface CieloVenda {
  id?: string;
  nsu: string;
  valorBruto: number;
  /** ISO yyyy-mm-dd */
  dataVenda?: string;
  formaPagamento?: string;
  autorizacao?: string | null;
}

export type MatchType = 'NSU_AUTH' | 'NSU' | 'DATA_VALOR';

export interface MatchPdvCieloResult {
  matched: Array<{
    pdv: PdvPagamento;
    cielo: CieloVenda;
    diff: number;
    matchType: MatchType;
  }>;
  /** Divergencia de valor: NSU bate OU proximidade por data+valor mas valor difere.
   * Usuario aceita (vira match confirmado) ou rejeita (vira 2 excecoes separadas). */
  divergenciaValor: Array<{ pdv: PdvPagamento; cielo: CieloVenda; diff: number }>;
  pdvSemCielo: PdvPagamento[];
  cieloSemPdv: CieloVenda[];
}

const TOL = 0.01;

/** Categoriza forma em {Debito, Credito, Pix, Outros} pra usar no fallback. */
function categoriaForma(s: string | undefined | null): string {
  if (!s) return 'Outros';
  const t = s.toLowerCase();
  if (t.includes('débito') || t.includes('debito')) return 'Debito';
  if (t.includes('crédito') || t.includes('credito')) return 'Credito';
  if (t.includes('pix')) return 'Pix';
  return 'Outros';
}

const MAX_DELTA_DIAS = 3;

function datasProximas(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // aceita +-N dias (virada de dia + fins de semana no TEF)
  const d1 = new Date(a + 'T00:00:00').getTime();
  const d2 = new Date(b + 'T00:00:00').getTime();
  const diffDias = Math.abs((d1 - d2) / 86_400_000);
  return diffDias <= MAX_DELTA_DIAS;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toUpperCase();
}

export function matchPdvCielo(
  pagamentos: PdvPagamento[],
  vendas: CieloVenda[],
): MatchPdvCieloResult {
  // Chave forte: NSU + autorizacao. Chave fraca: NSU com multiplos candidatos.
  const cieloByKey = new Map<string, CieloVenda>(); // nsu+auth → venda unica
  const cieloByNsu = new Map<string, CieloVenda[]>(); // nsu → todas as vendas com esse NSU
  for (const v of vendas) {
    const auth = norm(v.autorizacao);
    if (auth) cieloByKey.set(`${v.nsu}|${auth}`, v);
    const arr = cieloByNsu.get(v.nsu) ?? [];
    arr.push(v);
    cieloByNsu.set(v.nsu, arr);
  }

  const result: MatchPdvCieloResult = {
    matched: [],
    divergenciaValor: [],
    pdvSemCielo: [],
    cieloSemPdv: [],
  };
  const cieloUsadas = new Set<CieloVenda>();

  // Processa pagamentos em ordem cronologica pra que PDV mais antigo pegue a
  // Cielo mais antiga em caso de NSU ambiguo.
  const pagamentosOrdenados = [...pagamentos].sort((a, b) =>
    (a.dataPagamento ?? '').localeCompare(b.dataPagamento ?? ''),
  );

  // --- Passada 1: match forte (NSU + autorizacao) e fraco (NSU unico) ---
  for (const p of pagamentosOrdenados) {
    if (!p.nsu) {
      result.pdvSemCielo.push(p);
      continue;
    }

    let c: CieloVenda | undefined;
    let matchType: MatchType = 'NSU';

    // 1a. NSU + autorizacao (se o PDV tiver auth)
    const auth = norm(p.numeroAutorizacao);
    if (auth) {
      const cand = cieloByKey.get(`${p.nsu}|${auth}`);
      if (cand && !cieloUsadas.has(cand)) {
        c = cand;
        matchType = 'NSU_AUTH';
      }
    }

    // 1b. NSU so — mas so aceita se houver 1 candidato nao usado OU se um bater data+valor
    if (!c) {
      const arr = (cieloByNsu.get(p.nsu) ?? []).filter((v) => !cieloUsadas.has(v));
      if (arr.length === 1) {
        c = arr[0];
        matchType = 'NSU';
      } else if (arr.length > 1) {
        // desambigua: prefere o que bate data E valor
        const best =
          arr.find((v) => v.dataVenda === p.dataPagamento && Math.abs(v.valorBruto - p.valor) < TOL) ??
          arr.find((v) => v.dataVenda === p.dataPagamento);
        if (best) {
          c = best;
          matchType = 'NSU';
        }
        // se ainda ambiguo, deixa pra fallback data+valor
      }
    }

    if (!c) {
      result.pdvSemCielo.push(p);
      continue;
    }

    cieloUsadas.add(c);
    const diff = +(c.valorBruto - p.valor).toFixed(2);
    if (Math.abs(diff) < TOL) {
      result.matched.push({ pdv: p, cielo: c, diff, matchType });
    } else {
      result.divergenciaValor.push({ pdv: p, cielo: c, diff });
    }
  }

  const cieloSobrando: CieloVenda[] = vendas.filter((v) => !cieloUsadas.has(v));

  // --- Passada 2: fallback por (data, valor, categoria de forma) ---
  // Indexa sobra da Cielo por chave. Se chave tem >1 candidato → ambiguo, pula.
  const cieloPorChave = new Map<string, CieloVenda[]>();
  for (const v of cieloSobrando) {
    const cat = categoriaForma(v.formaPagamento);
    const valorKey = Math.round(v.valorBruto * 100);
    const dataKey = v.dataVenda ?? '';
    const key = `${dataKey}|${cat}|${valorKey}`;
    const arr = cieloPorChave.get(key) ?? [];
    arr.push(v);
    cieloPorChave.set(key, arr);
  }

  const pdvRestante: PdvPagamento[] = [];
  const cieloMatchedSegundaPassada = new Set<CieloVenda>();

  const MAX_DIFF_CENTAVOS = 3; // tolera ate +-R$ 0,03 de diff entre PDV e Cielo

  for (const p of result.pdvSemCielo) {
    const cat = categoriaForma(p.formaPagamento);
    const valorKey = Math.round(p.valor * 100);

    // tenta data exata, depois +-1..3 dias, e pra cada dia tenta valor exato,
    // depois +-1, +-2, +-3 centavos. Prioriza match mais apertado.
    const candidatos: CieloVenda[] = [];
    if (p.dataPagamento) {
      const deltasDia: number[] = [0];
      for (let i = 1; i <= MAX_DELTA_DIAS; i++) deltasDia.push(i, -i);
      const deltasValor: number[] = [0];
      for (let i = 1; i <= MAX_DIFF_CENTAVOS; i++) deltasValor.push(i, -i);
      // ordem: (delta dia, delta valor) com delta valor variando mais rapido
      outer: for (const dv of deltasValor) {
        for (const dd of deltasDia) {
          const d = new Date(p.dataPagamento + 'T00:00:00');
          d.setDate(d.getDate() + dd);
          const iso = d.toISOString().slice(0, 10);
          const arr = cieloPorChave.get(`${iso}|${cat}|${valorKey + dv}`) ?? [];
          for (const c of arr) {
            if (!cieloMatchedSegundaPassada.has(c) && datasProximas(p.dataPagamento, c.dataVenda)) {
              candidatos.push(c);
            }
          }
          if (candidatos.length > 0) break outer;
        }
      }
    }

    // Pega o primeiro candidato disponivel. Com N PDV e N Cielo mesmo grupo sem NSU,
    // pareiam 1:1 em ordem de delta mais proximo (dia exato + valor exato primeiro).
    if (candidatos.length >= 1) {
      const c = candidatos[0]!;
      cieloMatchedSegundaPassada.add(c);
      const diff = +(c.valorBruto - p.valor).toFixed(2);
      result.matched.push({ pdv: p, cielo: c, diff, matchType: 'DATA_VALOR' });
    } else {
      pdvRestante.push(p);
    }
  }

  result.pdvSemCielo = pdvRestante;
  result.cieloSemPdv = cieloSobrando.filter((v) => !cieloMatchedSegundaPassada.has(v));

  // --- Passada 3: fallback "solto" — se ainda sobrou PDV e Cielo same day+forma
  // com diff de valor ate 10%, marca como divergencia de valor (nao match).
  // Credito/Debito podem cross-matchar (operador pode ter errado a forma no PDV);
  // Pix e Outros continuam estritos. Como vira divergencia (nao match), user revisa. ---
  const TOL_DIVERGENCIA = 0.10; // 10% de tolerancia
  const pdvFinal: PdvPagamento[] = [];
  const catsCartao = new Set(['Credito', 'Debito']);
  for (const p of result.pdvSemCielo) {
    const cat = categoriaForma(p.formaPagamento);
    if (!p.dataPagamento) {
      pdvFinal.push(p);
      continue;
    }
    let melhor: { c: CieloVenda; diff: number } | null = null;
    for (const v of result.cieloSemPdv) {
      if (cieloMatchedSegundaPassada.has(v)) continue;
      const catV = categoriaForma(v.formaPagamento);
      const catsCompat =
        cat === catV || (catsCartao.has(cat) && catsCartao.has(catV));
      if (!catsCompat) continue;
      if (!datasProximas(p.dataPagamento, v.dataVenda)) continue;
      const diff = v.valorBruto - p.valor;
      const denom = Math.max(Math.abs(p.valor), Math.abs(v.valorBruto), 0.01);
      if (Math.abs(diff) / denom > TOL_DIVERGENCIA) continue;
      // Prefere cat igual; desempata por menor diff
      const catMatch = cat === catV ? 0 : 1;
      const melhorCatMatch = melhor
        ? cat === categoriaForma(melhor.c.formaPagamento) ? 0 : 1
        : Infinity;
      if (
        !melhor ||
        catMatch < melhorCatMatch ||
        (catMatch === melhorCatMatch && Math.abs(diff) < Math.abs(melhor.diff))
      ) {
        melhor = { c: v, diff: +diff.toFixed(2) };
      }
    }
    if (melhor) {
      cieloMatchedSegundaPassada.add(melhor.c);
      // Sem NSU + valor proximo → vira divergencia de valor (user aceita/rejeita).
      result.divergenciaValor.push({ pdv: p, cielo: melhor.c, diff: melhor.diff });
    } else {
      pdvFinal.push(p);
    }
  }
  result.pdvSemCielo = pdvFinal;
  result.cieloSemPdv = result.cieloSemPdv.filter((v) => !cieloMatchedSegundaPassada.has(v));

  return result;
}
