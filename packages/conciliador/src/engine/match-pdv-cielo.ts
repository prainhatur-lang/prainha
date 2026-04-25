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

/** Nivel da cascata (1=mais forte, 5=mais fraco/auto-revogavel).
 *  Vide doc da tabela match_pdv_cielo. */
export type NivelMatchCielo = 1 | 2 | 3 | 4 | 5;

export interface MatchPdvCieloResult {
  matched: Array<{
    pdv: PdvPagamento;
    cielo: CieloVenda;
    diff: number;
    matchType: MatchType;
    /** Nivel da cascata onde o match foi feito (1-5). Niveis 4-5 sao
     *  auto_revogavel: podem ser quebrados quando aparecer evidencia mais
     *  forte (ex: NSU bate em rodada futura). */
    nivel: NivelMatchCielo;
  }>;
  /** Divergencia de valor: NSU bate OU proximidade por data+valor mas valor difere.
   * Usuario aceita (vira match confirmado) ou rejeita (vira 2 excecoes separadas). */
  divergenciaValor: Array<{ pdv: PdvPagamento; cielo: CieloVenda; diff: number }>;
  pdvSemCielo: PdvPagamento[];
  cieloSemPdv: CieloVenda[];
}

const TOL = 0.01;

export interface ParamsMatchPdvCielo {
  /** Janela de proximidade em dias corridos (default 3). */
  janelaProximidadeDias: number;
  /** Tolerancia absoluta em R$ (default 0.10). Junto com toleranciaPercentual,
   *  o engine aceita diff <= max(absoluta, valor*percentual). */
  toleranciaAbsoluta: number;
  /** Tolerancia percentual decimal (default 0.01 = 1%). */
  toleranciaPercentual: number;
  /** Tolerancia maxima de divergencia em pareamento solto (default 0.10 = 10%). */
  toleranciaDivergencia: number;
}

const PARAMS_DEFAULT: ParamsMatchPdvCielo = {
  janelaProximidadeDias: 3,
  toleranciaAbsoluta: 0.1,
  toleranciaPercentual: 0.01,
  toleranciaDivergencia: 0.1,
};

/** Categoriza forma em {Debito, Credito, Pix, Outros} pra usar no fallback. */
function categoriaForma(s: string | undefined | null): string {
  if (!s) return 'Outros';
  const t = s.toLowerCase();
  if (t.includes('débito') || t.includes('debito')) return 'Debito';
  if (t.includes('crédito') || t.includes('credito')) return 'Credito';
  if (t.includes('pix')) return 'Pix';
  return 'Outros';
}

function datasProximas(
  a: string | undefined,
  b: string | undefined,
  janela: number,
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const d1 = new Date(a + 'T00:00:00').getTime();
  const d2 = new Date(b + 'T00:00:00').getTime();
  const diffDias = Math.abs((d1 - d2) / 86_400_000);
  return diffDias <= janela;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toUpperCase();
}

export function matchPdvCielo(
  pagamentos: PdvPagamento[],
  vendas: CieloVenda[],
  params: Partial<ParamsMatchPdvCielo> = {},
): MatchPdvCieloResult {
  const cfg: ParamsMatchPdvCielo = { ...PARAMS_DEFAULT, ...params };
  const MAX_DIFF_CENTAVOS = Math.round(cfg.toleranciaAbsoluta * 100);
  const TOL_DIVERGENCIA = cfg.toleranciaDivergencia;
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
    // NSU_AUTH (forte) -> nivel 1; NSU sozinho -> nivel 2.
    const nivel: NivelMatchCielo = matchType === 'NSU_AUTH' ? 1 : 2;
    if (Math.abs(diff) < TOL) {
      result.matched.push({ pdv: p, cielo: c, diff, matchType, nivel });
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

  for (const p of result.pdvSemCielo) {
    const cat = categoriaForma(p.formaPagamento);
    const valorKey = Math.round(p.valor * 100);

    // Tolerancia de valor pra essa transacao: max(absoluta, valor*percentual).
    // Ex: ticket R$ 5 com toleranciaAbs=0.10 e perc=0.01 → max(0.10, 0.05) = 0.10
    // Ticket R$ 500 com mesmas configs → max(0.10, 5.00) = 5.00
    const tolValor = Math.max(
      cfg.toleranciaAbsoluta,
      Math.abs(p.valor) * cfg.toleranciaPercentual,
    );
    const tolCentavos = Math.max(MAX_DIFF_CENTAVOS, Math.round(tolValor * 100));

    // tenta data exata, depois +-1..janela dias, e pra cada dia tenta valor
    // exato, depois +-1..tolCentavos centavos. Prioriza match mais apertado.
    const candidatos: CieloVenda[] = [];
    if (p.dataPagamento) {
      const deltasDia: number[] = [0];
      for (let i = 1; i <= cfg.janelaProximidadeDias; i++) deltasDia.push(i, -i);
      const deltasValor: number[] = [0];
      for (let i = 1; i <= tolCentavos; i++) deltasValor.push(i, -i);
      // ordem: (delta dia, delta valor) com delta valor variando mais rapido
      outer: for (const dv of deltasValor) {
        for (const dd of deltasDia) {
          const d = new Date(p.dataPagamento + 'T00:00:00');
          d.setDate(d.getDate() + dd);
          const iso = d.toISOString().slice(0, 10);
          const arr = cieloPorChave.get(`${iso}|${cat}|${valorKey + dv}`) ?? [];
          for (const c of arr) {
            if (
              !cieloMatchedSegundaPassada.has(c) &&
              datasProximas(p.dataPagamento, c.dataVenda, cfg.janelaProximidadeDias)
            ) {
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
      // Nivel 3: data exata + valor exato + categoria forma (limpo).
      // Nivel 5: dia diferente OU valor com tolerancia (auto-revogavel).
      const dataExata = p.dataPagamento === c.dataVenda;
      const valorExato = Math.abs(diff) < TOL;
      const nivel: NivelMatchCielo = dataExata && valorExato ? 3 : 5;
      result.matched.push({ pdv: p, cielo: c, diff, matchType: 'DATA_VALOR', nivel });
    } else {
      pdvRestante.push(p);
    }
  }

  result.pdvSemCielo = pdvRestante;
  result.cieloSemPdv = cieloSobrando.filter((v) => !cieloMatchedSegundaPassada.has(v));

  // --- Passada 3: fallback "solto" — se ainda sobrou PDV e Cielo same day+forma
  // com diff de valor ate 10%, marca como divergencia de valor (nao match).
  // Credito/Debito podem cross-matchar (operador pode ter errado a forma no PDV);
  // Pix e Outros continuam estritos. Como vira divergencia (nao match), user revisa.
  //
  // Matching GLOBAL: enumera todos os pares (p, c) candidatos, ordena por
  // (menor diff, mesma cat, data mais proxima) e aloca de forma gulosa. Isso
  // evita que um PDV com diff grande (ex: 0.30) consuma uma Cielo que outro
  // PDV casaria com diff 0. ---
  const catsCartao = new Set(['Credito', 'Debito']);
  type Candidato = {
    pIdx: number;
    c: CieloVenda;
    diff: number;
    sameCat: boolean;
    deltaDias: number;
  };
  const candidatos: Candidato[] = [];
  for (let i = 0; i < result.pdvSemCielo.length; i++) {
    const p = result.pdvSemCielo[i]!;
    if (!p.dataPagamento) continue;
    const cat = categoriaForma(p.formaPagamento);
    for (const v of result.cieloSemPdv) {
      if (cieloMatchedSegundaPassada.has(v)) continue;
      const catV = categoriaForma(v.formaPagamento);
      const catsCompat =
        cat === catV || (catsCartao.has(cat) && catsCartao.has(catV));
      if (!catsCompat) continue;
      if (!datasProximas(p.dataPagamento, v.dataVenda, cfg.janelaProximidadeDias)) continue;
      const diff = +(v.valorBruto - p.valor).toFixed(2);
      const denom = Math.max(Math.abs(p.valor), Math.abs(v.valorBruto), 0.01);
      if (Math.abs(diff) / denom > TOL_DIVERGENCIA) continue;
      const deltaDias = v.dataVenda
        ? Math.abs(
            (new Date(p.dataPagamento + 'T00:00:00').getTime() -
              new Date(v.dataVenda + 'T00:00:00').getTime()) /
              86_400_000,
          )
        : 0;
      candidatos.push({ pIdx: i, c: v, diff, sameCat: cat === catV, deltaDias });
    }
  }
  // Ordena: menor abs(diff) primeiro; depois same-cat; depois delta dias
  candidatos.sort((a, b) => {
    const da = Math.abs(a.diff);
    const db = Math.abs(b.diff);
    if (da !== db) return da - db;
    if (a.sameCat !== b.sameCat) return a.sameCat ? -1 : 1;
    return a.deltaDias - b.deltaDias;
  });
  const pdvMatched = new Set<number>();
  for (const cand of candidatos) {
    if (pdvMatched.has(cand.pIdx)) continue;
    if (cieloMatchedSegundaPassada.has(cand.c)) continue;
    pdvMatched.add(cand.pIdx);
    cieloMatchedSegundaPassada.add(cand.c);
    // Se diff ~= 0 E categoria igual, vira match direto (nao vira divergencia).
    // Cobre casos onde PDV perdeu o NSU mas valor+data+forma batem exato.
    // Casos cross-cat (Credito PDV x Debito Cielo) com diff=0 tambem indicam
    // o mesmo pagamento, mas vao como divergencia pra a engine auto-aceita-los
    // (a engine sabe criar o registro excecao pra rastreabilidade).
    if (Math.abs(cand.diff) < TOL && cand.sameCat) {
      // Passada 3 (matching solto): mesma cat + diff zero. Nivel 5 — auto-revogavel,
      // pode ser quebrado por NSU em rodada futura.
      result.matched.push({
        pdv: result.pdvSemCielo[cand.pIdx]!,
        cielo: cand.c,
        diff: cand.diff,
        matchType: 'DATA_VALOR',
        nivel: 5,
      });
    } else {
      result.divergenciaValor.push({
        pdv: result.pdvSemCielo[cand.pIdx]!,
        cielo: cand.c,
        diff: cand.diff,
      });
    }
  }
  const pdvFinal: PdvPagamento[] = [];
  for (let i = 0; i < result.pdvSemCielo.length; i++) {
    if (!pdvMatched.has(i)) pdvFinal.push(result.pdvSemCielo[i]!);
  }
  result.pdvSemCielo = pdvFinal;
  result.cieloSemPdv = result.cieloSemPdv.filter((v) => !cieloMatchedSegundaPassada.has(v));

  return result;
}
