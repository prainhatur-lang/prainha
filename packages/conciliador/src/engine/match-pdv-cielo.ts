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
}

export interface CieloVenda {
  id?: string;
  nsu: string;
  valorBruto: number;
  /** ISO yyyy-mm-dd */
  dataVenda?: string;
  formaPagamento?: string;
}

export type MatchType = 'NSU' | 'DATA_VALOR';

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

function datasProximas(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // aceita +-1 dia (virada de dia no TEF)
  const d1 = new Date(a + 'T00:00:00').getTime();
  const d2 = new Date(b + 'T00:00:00').getTime();
  const diffDias = Math.abs((d1 - d2) / 86_400_000);
  return diffDias <= 1;
}

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

  // --- Passada 1: NSU exato ---
  for (const p of pagamentos) {
    if (!p.nsu) {
      result.pdvSemCielo.push(p);
      continue;
    }
    const c = cieloByNsu.get(p.nsu);
    if (!c) {
      result.pdvSemCielo.push(p);
      continue;
    }
    cieloUsed.add(c.nsu);
    const diff = +(c.valorBruto - p.valor).toFixed(2);
    if (Math.abs(diff) < TOL) {
      result.matched.push({ pdv: p, cielo: c, diff, matchType: 'NSU' });
    } else {
      result.divergenciaValor.push({ pdv: p, cielo: c, diff });
    }
  }

  const cieloSobrando: CieloVenda[] = [];
  for (const v of vendas) if (!cieloUsed.has(v.nsu)) cieloSobrando.push(v);

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

    // tenta data exata, depois D-1 e D+1
    const candidatos: CieloVenda[] = [];
    if (p.dataPagamento) {
      for (const deltaD of [0, -1, 1]) {
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

    // So aceita se for unico candidato (evita match ambiguo)
    if (candidatos.length === 1) {
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
