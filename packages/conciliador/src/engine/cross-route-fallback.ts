// Cross-route fallback: detecta pagamentos que o garcom registrou em canal
// errado (Pix Online quando deveria ser Pix Manual, ou vice-versa).
//
// Casos cobertos:
//  - PDV(canal=ADQUIRENTE) sem match na Cielo, mas existe credito no banco
//    com valor + data compativeis e descricao PIX/TED -> sugere mover pra
//    canal DIRETO (tipo=PDV_ADQUIRENTE_PARA_BANCO)
//  - PDV(canal=DIRETO) sem match no banco, mas existe venda na Cielo com
//    NSU/valor compativeis -> sugere mover pra canal ADQUIRENTE
//    (tipo=PDV_DIRETO_PARA_CIELO)
//
// Sugestoes nunca viram match silencioso. O usuario aceita explicitamente,
// e ao aceitar:
//  1) Cria match na tabela apropriada (match_pdv_banco ou match cielo)
//  2) (Opcional) Reclassifica a forma de pagamento se for padrao recorrente
//
// Score:
//  1 = data exata + valor exato (alta confianca)
//  2 = data ±1 dia + valor exato (media confianca)

export interface PdvOrfao {
  id: string;
  valor: number;
  /** ISO yyyy-mm-dd */
  data: string;
  formaPagamento: string;
}

export interface CieloDisponivel {
  id: string;
  nsu: string | null;
  valorBruto: number;
  /** ISO yyyy-mm-dd */
  dataVenda: string;
  formaPagamento: string;
}

export interface BancoDisponivel {
  id: string;
  valor: number;
  /** ISO yyyy-mm-dd */
  data: string;
  descricao: string;
}

export type TipoSugestao = 'PDV_ADQUIRENTE_PARA_BANCO' | 'PDV_DIRETO_PARA_CIELO';

export interface SugestaoCrossRoute {
  pagamentoId: string;
  tipo: TipoSugestao;
  lancamentoBancoId?: string;
  vendaAdquirenteId?: string;
  score: 1 | 2;
  motivo: string;
}

const RE_DESC_DIRETA = /\b(pix|ted|doc|transfer[êe]ncia|transferencia)\b/i;
const TOL = 0.01;

function adicionarDias(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Checa se duas datas estão dentro de n dias corridos */
function diasProximos(a: string, b: string, n: number): boolean {
  if (a === b) return true;
  for (let i = 1; i <= n; i++) {
    if (adicionarDias(a, i) === b || adicionarDias(a, -i) === b) return true;
  }
  return false;
}

/** Cross-route ADQUIRENTE -> DIRETO: pagamentos PDV canal=ADQUIRENTE
 *  sem match na Cielo, casados contra creditos no banco com descricao PIX/TED. */
export function sugerirAdquirenteParaBanco(
  pdvOrfaos: PdvOrfao[],
  bancosDisponiveis: BancoDisponivel[],
): SugestaoCrossRoute[] {
  const sugestoes: SugestaoCrossRoute[] = [];
  const bancoUsado = new Set<string>();

  // Indexa banco por valor em centavos pra lookup rapido (apenas creditos
  // com descricao matching)
  const bancoElegivel = bancosDisponiveis.filter((b) =>
    RE_DESC_DIRETA.test(b.descricao ?? ''),
  );
  const indexBanco = new Map<number, BancoDisponivel[]>();
  for (const b of bancoElegivel) {
    const k = Math.round(b.valor * 100);
    const arr = indexBanco.get(k) ?? [];
    arr.push(b);
    indexBanco.set(k, arr);
  }

  // Score 1: data exata + valor exato
  for (const p of pdvOrfaos) {
    const arr = indexBanco.get(Math.round(p.valor * 100)) ?? [];
    const c = arr.find(
      (b) => !bancoUsado.has(b.id) && b.data === p.data && Math.abs(b.valor - p.valor) <= TOL,
    );
    if (c) {
      bancoUsado.add(c.id);
      sugestoes.push({
        pagamentoId: p.id,
        tipo: 'PDV_ADQUIRENTE_PARA_BANCO',
        lancamentoBancoId: c.id,
        score: 1,
        motivo: `Mesma data ${p.data} e valor exato. Descrição banco: "${c.descricao}". Talvez foi registrado como Pix Online mas caiu como Pix Manual.`,
      });
    }
  }

  // Score 2: data ±1 dia + valor exato
  for (const p of pdvOrfaos) {
    if (sugestoes.some((s) => s.pagamentoId === p.id)) continue;
    const arr = indexBanco.get(Math.round(p.valor * 100)) ?? [];
    const c = arr.find(
      (b) =>
        !bancoUsado.has(b.id) &&
        diasProximos(p.data, b.data, 1) &&
        Math.abs(b.valor - p.valor) <= TOL,
    );
    if (c) {
      bancoUsado.add(c.id);
      sugestoes.push({
        pagamentoId: p.id,
        tipo: 'PDV_ADQUIRENTE_PARA_BANCO',
        lancamentoBancoId: c.id,
        score: 2,
        motivo: `Data próxima (PDV ${p.data}, banco ${c.data}) e valor exato. Descrição: "${c.descricao}".`,
      });
    }
  }

  return sugestoes;
}

/** Cross-route DIRETO -> ADQUIRENTE: pagamentos PDV canal=DIRETO sem match
 *  no banco, casados contra vendas Cielo com valor + data compativeis. */
export function sugerirDiretoParaCielo(
  pdvOrfaos: PdvOrfao[],
  cieloDisponivel: CieloDisponivel[],
): SugestaoCrossRoute[] {
  const sugestoes: SugestaoCrossRoute[] = [];
  const cieloUsada = new Set<string>();

  const indexCielo = new Map<number, CieloDisponivel[]>();
  for (const v of cieloDisponivel) {
    const k = Math.round(v.valorBruto * 100);
    const arr = indexCielo.get(k) ?? [];
    arr.push(v);
    indexCielo.set(k, arr);
  }

  // Score 1: data exata + valor exato
  for (const p of pdvOrfaos) {
    const arr = indexCielo.get(Math.round(p.valor * 100)) ?? [];
    const c = arr.find(
      (v) =>
        !cieloUsada.has(v.id) &&
        v.dataVenda === p.data &&
        Math.abs(v.valorBruto - p.valor) <= TOL,
    );
    if (c) {
      cieloUsada.add(c.id);
      sugestoes.push({
        pagamentoId: p.id,
        tipo: 'PDV_DIRETO_PARA_CIELO',
        vendaAdquirenteId: c.id,
        score: 1,
        motivo: `Mesma data ${p.data} e valor exato na Cielo (NSU ${c.nsu ?? '—'}, ${c.formaPagamento}). Talvez foi registrado como Pix Manual mas passou pela maquininha.`,
      });
    }
  }

  // Score 2: data ±1 dia + valor exato
  for (const p of pdvOrfaos) {
    if (sugestoes.some((s) => s.pagamentoId === p.id)) continue;
    const arr = indexCielo.get(Math.round(p.valor * 100)) ?? [];
    const c = arr.find(
      (v) =>
        !cieloUsada.has(v.id) &&
        diasProximos(p.data, v.dataVenda, 1) &&
        Math.abs(v.valorBruto - p.valor) <= TOL,
    );
    if (c) {
      cieloUsada.add(c.id);
      sugestoes.push({
        pagamentoId: p.id,
        tipo: 'PDV_DIRETO_PARA_CIELO',
        vendaAdquirenteId: c.id,
        score: 2,
        motivo: `Data próxima (PDV ${p.data}, Cielo ${c.dataVenda}) e valor exato. NSU ${c.nsu ?? '—'}, ${c.formaPagamento}.`,
      });
    }
  }

  return sugestoes;
}
