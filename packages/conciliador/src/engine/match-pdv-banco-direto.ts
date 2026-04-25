// Engine de conciliacao: PDV (canal=DIRETO) <-> lancamento_banco (credito).
// Cobre Pix Manual, TED, DOC e outros pagamentos que vao direto pra conta
// bancaria sem passar por adquirente.
//
// Cascata fase 1 (sem E2E ID — fase 2 vira quando o agente extrair E2E
// de SOLICITACAOPAGAMENTO.IDENDTOEND do Consumer):
//
//  1) Valor exato + Data D ou D±1 dia util + descricao banco contem
//     "PIX/TED/DOC/PIX RECEBIDO" -> match firme
//  2) Valor exato + Data ±2 dias uteis + categoria PIX/transferencia
//     -> match auto_revogavel (sugestao)
//  3) Sobra -> exceção
//
// Garantias:
//  - 1:1: cada pagamento casa com no maximo 1 lancamento e vice-versa
//  - Determinismo: ordenacao estavel por (data, valor, id)
//  - Idempotente: pagamentos/lancamentos com match ja persistido nao
//    aparecem nas listas de entrada (caller filtra antes)

const TOL = 0.01;

export interface PdvDireto {
  id: string;
  /** Valor positivo do pagamento */
  valor: number;
  /** ISO yyyy-mm-dd da data do pagamento */
  data: string;
  formaPagamento: string;
}

export interface BancoCredito {
  id: string;
  /** Valor positivo (apenas creditos entram aqui) */
  valor: number;
  /** ISO yyyy-mm-dd da data do movimento */
  data: string;
  descricao: string;
}

export type NivelMatchDireto = 1 | 2;

export interface MatchPdvBancoResult {
  matched: Array<{
    pdv: PdvDireto;
    banco: BancoCredito;
    nivel: NivelMatchDireto;
    /** True quando match nivel 2 (revogavel) */
    autoRevogavel: boolean;
  }>;
  pdvSemBanco: PdvDireto[];
  bancoSemPdv: BancoCredito[];
}

const RE_DESC_DIRETA = /\b(pix|ted|doc|transfer[êe]ncia|transferencia)\b/i;

/** Adiciona N dias úteis a uma data ISO. Considera sábado/domingo. */
function addDiasUteis(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  let restante = Math.abs(n);
  const passo = n >= 0 ? 1 : -1;
  while (restante > 0) {
    d.setDate(d.getDate() + passo);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) restante--;
  }
  return d.toISOString().slice(0, 10);
}

/** Lista de datas ISO entre data±n dias uteis (incluindo a data base). */
function janelaDiasUteis(base: string, n: number): string[] {
  const datas = new Set<string>([base]);
  for (let i = 1; i <= n; i++) {
    datas.add(addDiasUteis(base, i));
    datas.add(addDiasUteis(base, -i));
  }
  return [...datas];
}

export function matchPdvBancoDireto(
  pagamentos: PdvDireto[],
  creditos: BancoCredito[],
): MatchPdvBancoResult {
  const result: MatchPdvBancoResult = {
    matched: [],
    pdvSemBanco: [],
    bancoSemPdv: [],
  };

  // Ordena pra determinismo
  const pdvOrdenados = [...pagamentos].sort(
    (a, b) => a.data.localeCompare(b.data) || a.valor - b.valor || a.id.localeCompare(b.id),
  );
  const bancoUsado = new Set<string>();

  // Indexa banco por (data, valorEmCentavos) pra lookups rapidos
  const bancoIndex = new Map<string, BancoCredito[]>();
  for (const c of creditos) {
    const key = `${c.data}|${Math.round(c.valor * 100)}`;
    const arr = bancoIndex.get(key) ?? [];
    arr.push(c);
    bancoIndex.set(key, arr);
  }

  function pegarCandidato(
    pdv: PdvDireto,
    janela: string[],
    requerDescricaoDireta: boolean,
  ): BancoCredito | null {
    const valorKey = Math.round(pdv.valor * 100);
    for (const data of janela) {
      const arr = bancoIndex.get(`${data}|${valorKey}`) ?? [];
      for (const c of arr) {
        if (bancoUsado.has(c.id)) continue;
        if (Math.abs(c.valor - pdv.valor) > TOL) continue;
        if (requerDescricaoDireta && !RE_DESC_DIRETA.test(c.descricao)) continue;
        return c;
      }
    }
    return null;
  }

  // --- Nivel 1: data D ou D±1 dia util + valor exato + descricao "PIX/TED/DOC" ---
  for (const p of pdvOrdenados) {
    const janela = janelaDiasUteis(p.data, 1);
    const c = pegarCandidato(p, janela, true);
    if (c) {
      bancoUsado.add(c.id);
      result.matched.push({ pdv: p, banco: c, nivel: 1, autoRevogavel: false });
    }
  }

  // --- Nivel 2: data ±2 dias uteis + valor exato (descricao opcional) ---
  for (const p of pdvOrdenados) {
    if (result.matched.some((m) => m.pdv.id === p.id)) continue;
    const janela = janelaDiasUteis(p.data, 2);
    const c = pegarCandidato(p, janela, false);
    if (c) {
      bancoUsado.add(c.id);
      result.matched.push({ pdv: p, banco: c, nivel: 2, autoRevogavel: true });
    }
  }

  // --- Sobras ---
  const idsMatched = new Set(result.matched.map((m) => m.pdv.id));
  for (const p of pdvOrdenados) {
    if (!idsMatched.has(p.id)) result.pdvSemBanco.push(p);
  }
  for (const c of creditos) {
    if (!bancoUsado.has(c.id)) result.bancoSemPdv.push(c);
  }

  return result;
}
