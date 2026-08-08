// Tipos e helpers do módulo de orçamentos de eventos.
// Puro (sem imports de servidor) — usável em client e server components.

/** Um prato do cardápio do orçamento (espelho do jsonb no schema). */
export interface PratoOrcamento {
  nome: string;
  descricao?: string;
  /** 'livre' = à vontade durante o evento; 'limitado' = quantidade definida. */
  regime: 'livre' | 'limitado';
  /** Quantidade quando limitado — texto livre (ex: "1 por pessoa", "6 travessas"). */
  qtd?: string;
}

export type StatusOrcamento = 'aberto' | 'enviado' | 'aceito' | 'recusado';

/** Uma opção de local do evento: a filial inteira ou um ambiente só-eventos
 *  dela (ex: Terraço no Prainha Bar). */
export interface LocalOpt {
  filialId: string;
  /** Nome do ambiente. Null = a casa/filial toda. */
  local: string | null;
  label: string;
}

export const STATUS_ORCAMENTO: Record<StatusOrcamento, { label: string; cor: string }> = {
  aberto: { label: 'Aberto', cor: 'bg-slate-100 text-slate-700' },
  enviado: { label: 'Enviado', cor: 'bg-blue-100 text-blue-700' },
  aceito: { label: 'Aceito', cor: 'bg-emerald-100 text-emerald-700' },
  recusado: { label: 'Recusado', cor: 'bg-rose-100 text-rose-700' },
};

const DIAS_SEMANA = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

/** Dia da semana em pt-BR de um YYYY-MM-DD. UTC puro — imune ao TZ do server. */
export function diaSemanaBr(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return '';
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Parseia valor em R$ digitado pelo usuário ("1.234,56", "1234.56", "120"). */
export function parseValor(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  // Com vírgula = formato BR: pontos são milhar. Sem vírgula: ponto é decimal.
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalizado);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface TotaisOrcamento {
  /** valorPessoa × pessoas. Null quando valorPessoa não informado. */
  subtotalMenu: number | null;
  taxaEspaco: number | null;
  taxaExclusividade: number | null;
  /** Soma do que estiver preenchido. Null = nada precificado (a combinar). */
  total: number | null;
}

export function calcularTotais(o: {
  pessoas: number;
  valorPessoa: number | null;
  taxaEspaco: number | null;
  taxaExclusividade: number | null;
}): TotaisOrcamento {
  const subtotalMenu = o.valorPessoa != null ? o.valorPessoa * o.pessoas : null;
  const parcelas = [subtotalMenu, o.taxaEspaco, o.taxaExclusividade].filter(
    (v): v is number => v != null,
  );
  return {
    subtotalMenu,
    taxaEspaco: o.taxaEspaco,
    taxaExclusividade: o.taxaExclusividade,
    total: parcelas.length > 0 ? parcelas.reduce((s, v) => s + v, 0) : null,
  };
}

/** Formata o nº sequencial do orçamento pro documento (ex: 12 → "0012"). */
export function numeroOrcamento(n: number): string {
  return String(n).padStart(4, '0');
}

/** Sanitiza a lista de pratos vinda do body JSON (uso nas rotas de API). */
export function sanitizarPratos(v: unknown): PratoOrcamento[] {
  if (!Array.isArray(v)) return [];
  const txt = (s: unknown, max: number) =>
    typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null;
  return v
    .slice(0, 50)
    .map((p): PratoOrcamento | null => {
      const nome = txt(p?.nome, 200);
      if (!nome) return null;
      const regime = p?.regime === 'limitado' ? 'limitado' : 'livre';
      const prato: PratoOrcamento = { nome, regime };
      const descricao = txt(p?.descricao, 500);
      if (descricao) prato.descricao = descricao;
      const qtd = txt(p?.qtd, 100);
      if (regime === 'limitado' && qtd) prato.qtd = qtd;
      return prato;
    })
    .filter((p): p is PratoOrcamento => p !== null);
}
