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

  for (const p of result.pdvSemCielo) {
    const cat = categoriaForma(p.formaPagamento);
    const valorKey = Math.round(p.valor * 100);

    // tenta data exata, depois +-1, +-2, +-3 dias
    const candidatos: CieloVenda[] = [];
    if (p.dataPagamento) {
      const deltas: number[] = [0];
      for (let i = 1; i <= MAX_DELTA_DIAS; i++) deltas.push(i, -i);
      for (const deltaD of deltas) {
        const d = new Date(p.dataPagamento + 'T00:00:00');
        d.setDate(d.getDate() + deltaD);
        const iso = d.toISOString().slice(0, 10);
        const arr = cieloPorChave.get(`${iso}|${cat}|${valorKey}`) ?? [];
        for (const c of arr) {
          if (!cieloMatchedSegundaPassada.has(c) && datasProximas(p.dataPagamento, c.dataVenda)) {
            candidatos.push(c);
          }
        }
      }
    }

    // Pega o primeiro candidato disponivel (prioridade por delta=0, D+1, D-1, ...).
    // Com N PDV e N Cielo mesmo (data,valor,forma) sem NSU, vao parear 1:1 em ordem.
    if (candidatos.length >= 1) {
      const c = candidatos[0]!;
      cieloMatchedSegundaPassada.add(c);
      result.matched.push({ pdv: p, cielo: c, diff: 0, matchType: 'DATA_VALOR' });
    } else {
      pdvRestante.push(p);
    }
  }

  result.pdvSemCielo = pdvRestante;
  result.cieloSemPdv = cieloSobrando.filter((v) => !cieloMatchedSegundaPassada.has(v));

  return result;
}
