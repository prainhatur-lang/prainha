// Histórico de faturamento (VGV) — carga dos números e as contas da aba.
//
// De onde vem cada mês de cada unidade:
//   - casa do sistema, do mês `sistemaDesde` em diante → PDV ao vivo (tabela
//     `pedido`, mesmo critério do fechamento: soma de valor_total por
//     data_fechamento em BRT, sem os apagados);
//   - o resto → total do mês lançado (planilha do dono ou digitado na aba);
//   - por cima, em qualquer caso, os eventos e festas fora do PDV (EXTRA).
//
// Toda comparação é contra os MESMOS meses 12 meses antes, e só com mês
// fechado (o mês em andamento aparece, mas não entra em conta nenhuma).
//
// A parte pura (montar + contas) não toca no banco nem no Next — roda em teste.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { hojeBr } from './datas';
import { chaveMes, intervaloMeses, partesMes, somaMeses } from './faturamento-meses';

type Exec = Pick<typeof db, 'execute'>;

// ---------- Tipos ----------

export interface Unidade {
  id: string;
  nome: string;
  /** Casa do sistema (o PDV responde a partir de sistemaDesde) ou null = de fora. */
  filialId: string | null;
  /** 'YYYY-MM' do primeiro mês em que o total do PDV vale. */
  sistemaDesde: string | null;
  /** 'YYYY-MM' do primeiro mês em que a unidade não opera mais. */
  encerradaDesde: string | null;
  ordem: number;
}

export interface Lancamento {
  id: string;
  unidadeId: string;
  ano: number;
  mes: number;
  tipo: 'TOTAL' | 'EXTRA';
  valor: number;
  observacao: string | null;
  origem: string;
}

export interface Celula {
  /** Faturamento do mês SEM eventos: PDV ou total lançado. null = sem número. */
  base: number | null;
  fonte: 'pdv' | 'lancado' | null;
  /** Eventos e festas fora do PDV (soma). */
  extra: number;
}

export interface Historico {
  unidades: Unidade[];
  lancamentos: Lancamento[];
  /** unidadeId → 'YYYY-MM' → célula (só meses com número ou evento). */
  celulas: Map<string, Map<string, Celula>>;
  /** unidadeId → primeiro mês com número (null = nunca teve). */
  inicio: Map<string, string | null>;
  /** Primeiro mês com número em qualquer unidade. */
  primeiroMes: string;
  /** Mês em andamento (parcial). */
  mesAtual: string;
  /** Último mês fechado — tudo é medido até aqui. */
  mesFechado: string;
  hoje: string;
}

export interface EntradaHistorico {
  unidades: Unidade[];
  lancamentos: Lancamento[];
  /** Total do PDV por unidade/mês (só meses com pedido). */
  pdv: Array<{ unidadeId: string; mes: string; total: number }>;
  /** Hoje em BRT (YYYY-MM-DD). */
  hoje: string;
}

// ---------- Meses (moram em faturamento-meses.ts, que o navegador também usa) ----------

export {
  MESES_CURTOS,
  chaveMes,
  intervaloMeses,
  mesValido,
  partesMes,
  rotuloMes,
  somaMeses,
} from './faturamento-meses';

// ---------- Montagem ----------

/** O PDV responde por este mês desta unidade? */
export function pdvCobre(
  u: Pick<Unidade, 'filialId' | 'sistemaDesde'>,
  mes: string,
  mesAtual: string,
): boolean {
  return u.filialId !== null && u.sistemaDesde !== null && mes >= u.sistemaDesde && mes <= mesAtual;
}

export function montarHistorico(e: EntradaHistorico): Historico {
  const mesAtual = e.hoje.slice(0, 7);
  const mesFechado = somaMeses(mesAtual, -1);

  const pdv = new Map<string, Map<string, number>>();
  for (const p of e.pdv) {
    if (!pdv.has(p.unidadeId)) pdv.set(p.unidadeId, new Map());
    pdv.get(p.unidadeId)!.set(p.mes, Number(p.total) || 0);
  }
  const total = new Map<string, Map<string, number>>();
  const extra = new Map<string, Map<string, number>>();
  for (const l of e.lancamentos) {
    const alvo = l.tipo === 'TOTAL' ? total : extra;
    if (!alvo.has(l.unidadeId)) alvo.set(l.unidadeId, new Map());
    const m = alvo.get(l.unidadeId)!;
    const k = chaveMes(l.ano, l.mes);
    // TOTAL é um só por mês; EXTRA soma (cada evento é uma linha).
    m.set(k, l.tipo === 'TOTAL' ? l.valor : (m.get(k) ?? 0) + l.valor);
  }

  // Onde a história começa: o primeiro mês com qualquer número.
  let primeiroMes = mesAtual;
  for (const u of e.unidades) {
    for (const k of total.get(u.id)?.keys() ?? []) if (k < primeiroMes) primeiroMes = k;
    for (const k of extra.get(u.id)?.keys() ?? []) if (k < primeiroMes) primeiroMes = k;
    if (u.filialId && u.sistemaDesde) {
      for (const k of pdv.get(u.id)?.keys() ?? []) {
        if (k >= u.sistemaDesde && k < primeiroMes) primeiroMes = k;
      }
    }
  }

  const celulas = new Map<string, Map<string, Celula>>();
  const inicio = new Map<string, string | null>();
  for (const u of e.unidades) {
    const mapa = new Map<string, Celula>();
    let primeiro: string | null = null;
    for (const mes of intervaloMeses(primeiroMes, mesAtual)) {
      let base: number | null = null;
      let fonte: Celula['fonte'] = null;
      if (pdvCobre(u, mes, mesAtual)) {
        base = pdv.get(u.id)?.get(mes) ?? 0;
        fonte = 'pdv';
      } else {
        const t = total.get(u.id)?.get(mes);
        if (t !== undefined) {
          base = t;
          fonte = 'lancado';
        }
      }
      // Unidade marcada como parada: mês zerado dali em diante não é número.
      if (u.encerradaDesde && mes >= u.encerradaDesde && (base === null || base === 0)) {
        base = null;
        fonte = null;
      }
      const ex = extra.get(u.id)?.get(mes) ?? 0;
      if (base !== null && primeiro === null) primeiro = mes;
      if (base !== null || ex !== 0) mapa.set(mes, { base, fonte, extra: ex });
    }
    celulas.set(u.id, mapa);
    inicio.set(u.id, primeiro);
  }

  return {
    unidades: e.unidades,
    lancamentos: e.lancamentos,
    celulas,
    inicio,
    primeiroMes,
    mesAtual,
    mesFechado,
    hoje: e.hoje,
  };
}

// ---------- Contas ----------

export function celula(h: Historico, unidadeId: string, mes: string): Celula | undefined {
  return h.celulas.get(unidadeId)?.get(mes);
}

export function valorDe(c: Celula | undefined, comEventos: boolean): number {
  if (!c) return 0;
  return (c.base ?? 0) + (comEventos ? c.extra : 0);
}

export type Situacao = 'numero' | 'pendente' | 'encerrada' | 'andamento' | 'antes' | 'futuro';

/** Como está o mês de uma unidade. `pendente` = devia ter número e está em branco. */
export function situacao(h: Historico, u: Unidade, mes: string): Situacao {
  if (mes > h.mesAtual) return 'futuro';
  if (celula(h, u.id, mes)?.base != null) return 'numero';
  const ini = h.inicio.get(u.id) ?? null;
  if (ini === null || mes < ini) return 'antes';
  if (u.encerradaDesde && mes >= u.encerradaDesde) return 'encerrada';
  if (mes === h.mesAtual) return 'andamento';
  return 'pendente';
}

export function totalPeriodo(
  h: Historico,
  ids: string[],
  meses: string[],
  comEventos: boolean,
): number {
  let s = 0;
  for (const id of ids) for (const m of meses) s += valorDe(celula(h, id, m), comEventos);
  return s;
}

export function variacao(atual: number, anterior: number): number | null {
  return anterior > 0 ? (atual - anterior) / anterior : null;
}

export interface Comparacao {
  /** Período medido e os mesmos meses 12 meses antes. */
  meses: string[];
  mesesAntes: string[];
  atual: number;
  anterior: number;
  variacao: number | null;
  /**
   * Sem os em branco: o total, tirando dos DOIS lados o unidade-mês que devia
   * ter número este ano e está em branco — não conta como zero o que só não foi
   * lançado. Sem mês em branco, é igual ao total.
   */
  sb: { atual: number; anterior: number; variacao: number | null };
  /**
   * Mesma base: só conta unidade-mês com número nos DOIS lados — casa nova,
   * parada ou sem lançamento fica de fora. `meses` = quantos unidade-mês entraram.
   */
  mb: { atual: number; anterior: number; variacao: number | null; meses: number };
  /** Unidades que ficaram fora da mesma base em algum mês, e por quê. */
  fora: Array<{ nome: string; motivo: 'nova' | 'parada' | 'em-branco' }>;
  /** Quantos unidade-mês do período estão em branco e deviam ter número. */
  pendentes: number;
}

export function comparar(
  h: Historico,
  ids: string[],
  meses: string[],
  comEventos: boolean,
): Comparacao {
  const mesesAntes = meses.map((m) => somaMeses(m, -12));
  let atual = 0;
  let anterior = 0;
  let sbAtual = 0;
  let sbAnterior = 0;
  let mbAtual = 0;
  let mbAnterior = 0;
  let mbMeses = 0;
  let pendentes = 0;
  const fora = new Map<string, 'nova' | 'parada' | 'em-branco'>();

  for (const u of h.unidades) {
    if (!ids.includes(u.id)) continue;
    for (let i = 0; i < meses.length; i++) {
      const ca = celula(h, u.id, meses[i]!);
      const cp = celula(h, u.id, mesesAntes[i]!);
      const va = valorDe(ca, comEventos);
      const vp = valorDe(cp, comEventos);
      atual += va;
      anterior += vp;
      const temA = ca?.base != null;
      const temP = cp?.base != null;
      const emBranco = !temA && temP && situacao(h, u, meses[i]!) === 'pendente';
      if (!emBranco) {
        sbAtual += va;
        sbAnterior += vp;
      }
      if (temA && temP) {
        mbAtual += va;
        mbAnterior += vp;
        mbMeses++;
      } else if (temA) {
        if (!fora.has(u.nome)) fora.set(u.nome, 'nova');
      } else if (emBranco) {
        pendentes++;
        fora.set(u.nome, 'em-branco');
      } else if (temP && fora.get(u.nome) !== 'em-branco') {
        fora.set(u.nome, 'parada');
      }
    }
  }

  return {
    meses,
    mesesAntes,
    atual,
    anterior,
    variacao: variacao(atual, anterior),
    sb: { atual: sbAtual, anterior: sbAnterior, variacao: variacao(sbAtual, sbAnterior) },
    mb: {
      atual: mbAtual,
      anterior: mbAnterior,
      variacao: variacao(mbAtual, mbAnterior),
      meses: mbMeses,
    },
    fora: [...fora].map(([nome, motivo]) => ({ nome, motivo })),
    pendentes,
  };
}

export interface Resumo {
  /** 12 meses fechados contra os 12 anteriores — a tendência. */
  ultimos12: Comparacao;
  /** Janeiro até o último mês fechado contra o mesmo período do ano anterior. */
  anoAteAgora: Comparacao;
  /** Os 3 últimos meses fechados. */
  trimestre: Comparacao;
  ultimoMes: Comparacao;
}

export function resumo(h: Historico, ids: string[], comEventos: boolean): Resumo {
  const f = h.mesFechado;
  const { ano } = partesMes(f);
  return {
    ultimos12: comparar(h, ids, intervaloMeses(somaMeses(f, -11), f), comEventos),
    anoAteAgora: comparar(h, ids, intervaloMeses(chaveMes(ano, 1), f), comEventos),
    trimestre: comparar(h, ids, intervaloMeses(somaMeses(f, -2), f), comEventos),
    ultimoMes: comparar(h, ids, [f], comEventos),
  };
}

export type Tendencia = 'crescendo' | 'caindo' | 'estavel' | 'sem-base';

/** Faixa de ±3% é "estável" — menos que isso é ruído de calendário. */
export function tendencia(v: number | null): Tendencia {
  if (v === null) return 'sem-base';
  if (v >= 0.03) return 'crescendo';
  if (v <= -0.03) return 'caindo';
  return 'estavel';
}

export type BaseVeredito = 'total' | 'sem-branco' | 'mesma-base';

export interface Veredito {
  tendencia: Tendencia;
  variacao: number | null;
  /** Os dois valores que a variação compara (na base escolhida). */
  atual: number;
  anterior: number;
  base: BaseVeredito;
}

/**
 * A resposta de "está crescendo?" e em que base ela é dada:
 *   - `total`: o normal. Casa nova que entra é VGV que cresceu de verdade, e
 *     casa que parou é VGV que saiu.
 *   - `sem-branco`: há unidade-mês em branco que devia ter número (ainda não
 *     lançaram) — esses meses saem dos dois lados, senão o total contaria como
 *     zero o que só falta digitar.
 *   - `mesma-base`: olhando UMA unidade que não tem os dois períodos inteiros
 *     (abriu, parou ou tem mês em branco) — só os meses com número nos dois
 *     anos. 12 meses contra 6 não é crescimento.
 * Sem nada pra comparar do outro lado, não há base (`sem-base`).
 */
export function veredito(c: Comparacao, umaUnidade = false): Veredito {
  const base: BaseVeredito =
    umaUnidade && c.fora.length > 0 ? 'mesma-base' : c.pendentes > 0 ? 'sem-branco' : 'total';
  const par = base === 'mesma-base' ? c.mb : base === 'sem-branco' ? c.sb : c;
  return {
    tendencia: tendencia(par.variacao),
    variacao: par.variacao,
    atual: par.atual,
    anterior: par.anterior,
    base,
  };
}

/** Primeiro mês com número entre as unidades escolhidas. */
export function inicioDoEscopo(h: Historico, ids: string[]): string | null {
  let ini: string | null = null;
  for (const id of ids) {
    const i = h.inicio.get(id) ?? null;
    if (i !== null && (ini === null || i < ini)) ini = i;
  }
  return ini;
}

/** VGV acumulado em 12 meses, mês a mês (cada ponto = soma dos 12 meses até ali). */
export function serie12Meses(
  h: Historico,
  ids: string[],
  comEventos: boolean,
): Array<{ mes: string; valor: number }> {
  const ini = inicioDoEscopo(h, ids);
  if (ini === null) return [];
  const out: Array<{ mes: string; valor: number }> = [];
  for (const mes of intervaloMeses(somaMeses(ini, 11), h.mesFechado)) {
    out.push({
      mes,
      valor: totalPeriodo(h, ids, intervaloMeses(somaMeses(mes, -11), mes), comEventos),
    });
  }
  return out;
}

export interface AnoResumo {
  ano: number;
  /** Meses fechados do ano. */
  total: number;
  /** Janeiro até o mês de referência (o mesmo recorte em todo ano). */
  ateRef: number;
  /** Eventos dentro do total. */
  eventos: number;
  /** Meses fechados com número. */
  meses: number;
  /** Ano fechado inteiro (12 meses possíveis)? */
  completo: boolean;
}

/** Mês de referência = o do último mês fechado (set → compara jan–set de todo ano). */
export function mesReferencia(h: Historico): number {
  return partesMes(h.mesFechado).mes;
}

export function porAno(h: Historico, ids: string[], comEventos: boolean): AnoResumo[] {
  const ini = inicioDoEscopo(h, ids);
  if (ini === null) return [];
  const ref = mesReferencia(h);
  const ultimoAno = partesMes(h.mesFechado).ano;
  const out: AnoResumo[] = [];
  for (let ano = partesMes(ini).ano; ano <= ultimoAno; ano++) {
    let total = 0;
    let ateRef = 0;
    let eventos = 0;
    let meses = 0;
    for (let mes = 1; mes <= 12; mes++) {
      const k = chaveMes(ano, mes);
      if (k > h.mesFechado) break;
      let tem = false;
      for (const id of ids) {
        const c = celula(h, id, k);
        if (!c) continue;
        const v = valorDe(c, comEventos);
        total += v;
        if (mes <= ref) ateRef += v;
        if (comEventos) eventos += c.extra;
        if (c.base !== null) tem = true;
      }
      if (tem) meses++;
    }
    out.push({ ano, total, ateRef, eventos, meses, completo: ano < ultimoAno || ref === 12 });
  }
  return out;
}

export interface CelulaMatriz {
  mes: string;
  /** null = nenhuma unidade do escopo tem número nesse mês. */
  valor: number | null;
  eventos: number;
  /** Contra o mesmo mês do ano anterior (só mês fechado, com número nos dois). */
  variacao: number | null;
  parcial: boolean;
  futuro: boolean;
  /** Alguma unidade do escopo em branco que devia ter número. */
  pendente: boolean;
}

/** Mês × ano: linhas = 12 meses, colunas = anos. */
export function matriz(
  h: Historico,
  ids: string[],
  comEventos: boolean,
): { anos: number[]; linhas: CelulaMatriz[][] } {
  const ini = inicioDoEscopo(h, ids);
  const anoIni = partesMes(ini ?? h.mesAtual).ano;
  const anoFim = partesMes(h.mesAtual).ano;
  const anos: number[] = [];
  for (let a = anoIni; a <= anoFim; a++) anos.push(a);
  const unidades = h.unidades.filter((u) => ids.includes(u.id));

  const valorMes = (k: string): { valor: number | null; eventos: number } => {
    let tem = false;
    let s = 0;
    let ev = 0;
    for (const u of unidades) {
      const c = celula(h, u.id, k);
      if (!c) continue;
      if (c.base !== null || (comEventos && c.extra !== 0)) tem = true;
      s += valorDe(c, comEventos);
      if (comEventos) ev += c.extra;
    }
    return { valor: tem ? s : null, eventos: ev };
  };

  const linhas: CelulaMatriz[][] = [];
  for (let mes = 1; mes <= 12; mes++) {
    const linha: CelulaMatriz[] = [];
    for (const ano of anos) {
      const k = chaveMes(ano, mes);
      const futuro = k > h.mesAtual;
      const parcial = k === h.mesAtual;
      const { valor, eventos } = futuro ? { valor: null, eventos: 0 } : valorMes(k);
      const antes = valorMes(chaveMes(ano - 1, mes)).valor;
      linha.push({
        mes: k,
        valor,
        eventos,
        variacao:
          !parcial && !futuro && valor !== null && antes !== null ? variacao(valor, antes) : null,
        parcial,
        futuro,
        pendente: !futuro && unidades.some((u) => situacao(h, u, k) === 'pendente'),
      });
    }
    linhas.push(linha);
  }
  return { anos, linhas };
}

export interface Pendencia {
  unidade: Unidade;
  /** Meses fechados em branco que deviam ter número. */
  meses: string[];
  /** Se os meses em branco vão até o último mês fechado: onde esse bloco começa. */
  blocoFinalDesde: string | null;
}

export function pendencias(h: Historico): Pendencia[] {
  const out: Pendencia[] = [];
  for (const u of h.unidades) {
    const ini = h.inicio.get(u.id) ?? null;
    if (ini === null) continue;
    const meses = intervaloMeses(ini, h.mesFechado).filter(
      (m) => situacao(h, u, m) === 'pendente',
    );
    if (meses.length === 0) continue;
    let blocoFinalDesde: string | null = null;
    for (let m = h.mesFechado; meses.includes(m); m = somaMeses(m, -1)) blocoFinalDesde = m;
    out.push({ unidade: u, meses, blocoFinalDesde });
  }
  return out;
}

// ---------- Banco: leitura ----------

export async function carregarHistorico(orgId: string, hoje: string = hojeBr()): Promise<Historico> {
  const [unidades, lancamentos, vivo, fotos] = await Promise.all([
    db.execute(sql`
      SELECT id, nome, filial_id,
             to_char(sistema_desde, 'YYYY-MM') AS sistema_desde,
             to_char(encerrada_desde, 'YYYY-MM') AS encerrada_desde,
             ordem
        FROM faturamento_unidade
       WHERE organizacao_id = ${orgId}::uuid AND ativa
       ORDER BY ordem, nome
    `) as unknown as Promise<
      Array<{
        id: string;
        nome: string;
        filial_id: string | null;
        sistema_desde: string | null;
        encerrada_desde: string | null;
        ordem: number;
      }>
    >,
    db.execute(sql`
      SELECT l.id, l.unidade_id, l.ano, l.mes, l.tipo, l.valor::float8 AS valor,
             l.observacao, l.origem
        FROM faturamento_lancamento l
        JOIN faturamento_unidade u ON u.id = l.unidade_id
       WHERE u.organizacao_id = ${orgId}::uuid AND u.ativa
       ORDER BY l.ano, l.mes, l.criado_em
    `) as unknown as Promise<
      Array<{
        id: string;
        unidade_id: string;
        ano: number;
        mes: number;
        tipo: string;
        valor: number;
        observacao: string | null;
        origem: string;
      }>
    >,
    // PDV ao vivo, por mês em BRT. Mesmo critério do fechamento.
    db.execute(sql`
      SELECT u.id AS unidade_id,
             to_char((p.data_fechamento AT TIME ZONE 'UTC') - interval '3 hours', 'YYYY-MM') AS mes,
             sum(p.valor_total)::float8 AS total
        FROM faturamento_unidade u
        JOIN pedido p ON p.filial_id = u.filial_id
       WHERE u.organizacao_id = ${orgId}::uuid AND u.ativa
         AND u.filial_id IS NOT NULL AND u.sistema_desde IS NOT NULL
         AND p.data_delete IS NULL AND p.data_fechamento IS NOT NULL
         AND p.data_fechamento >= (u.sistema_desde::text || ' 00:00:00-03')::timestamptz
       GROUP BY 1, 2
    `) as unknown as Promise<Array<{ unidade_id: string; mes: string; total: number | null }>>,
    // Foto do mês fechado (fechamento_mensal): só entra se um dia o pedido
    // bruto de um mês antigo for apagado — hoje todo mês tem pedido e a foto
    // não é usada.
    db.execute(sql`
      SELECT u.id AS unidade_id,
             to_char(make_date(fm.ano, fm.mes, 1), 'YYYY-MM') AS mes,
             fm.total_vendas::float8 AS total
        FROM faturamento_unidade u
        JOIN fechamento_mensal fm ON fm.filial_id = u.filial_id
       WHERE u.organizacao_id = ${orgId}::uuid AND u.ativa
         AND u.sistema_desde IS NOT NULL
         AND make_date(fm.ano, fm.mes, 1) >= u.sistema_desde
    `) as unknown as Promise<Array<{ unidade_id: string; mes: string; total: number | null }>>,
  ]);

  const pdv = new Map<string, { unidadeId: string; mes: string; total: number }>();
  for (const f of fotos) {
    pdv.set(`${f.unidade_id}|${f.mes}`, {
      unidadeId: f.unidade_id,
      mes: f.mes,
      total: Number(f.total) || 0,
    });
  }
  // O que está vivo ganha da foto.
  for (const v of vivo) {
    pdv.set(`${v.unidade_id}|${v.mes}`, {
      unidadeId: v.unidade_id,
      mes: v.mes,
      total: Number(v.total) || 0,
    });
  }

  return montarHistorico({
    unidades: unidades.map((u) => ({
      id: u.id,
      nome: u.nome,
      filialId: u.filial_id,
      sistemaDesde: u.sistema_desde,
      encerradaDesde: u.encerrada_desde,
      ordem: Number(u.ordem),
    })),
    lancamentos: lancamentos.map((l) => ({
      id: l.id,
      unidadeId: l.unidade_id,
      ano: Number(l.ano),
      mes: Number(l.mes),
      tipo: l.tipo === 'EXTRA' ? 'EXTRA' : 'TOTAL',
      valor: Number(l.valor) || 0,
      observacao: l.observacao,
      origem: l.origem,
    })),
    pdv: [...pdv.values()],
    hoje,
  });
}

// ---------- Banco: escrita (as rotas conferem permissão, senha e organização) ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function ehUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

export interface UnidadeDaOrg extends Unidade {
  organizacaoId: string;
}

export async function unidadeDaOrg(unidadeId: string, ex: Exec = db): Promise<UnidadeDaOrg | null> {
  const rows = (await ex.execute(sql`
    SELECT id, organizacao_id, nome, filial_id,
           to_char(sistema_desde, 'YYYY-MM') AS sistema_desde,
           to_char(encerrada_desde, 'YYYY-MM') AS encerrada_desde,
           ordem
      FROM faturamento_unidade
     WHERE id = ${unidadeId}::uuid AND ativa
  `)) as unknown as Array<{
    id: string;
    organizacao_id: string;
    nome: string;
    filial_id: string | null;
    sistema_desde: string | null;
    encerrada_desde: string | null;
    ordem: number;
  }>;
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.id,
    organizacaoId: u.organizacao_id,
    nome: u.nome,
    filialId: u.filial_id,
    sistemaDesde: u.sistema_desde,
    encerradaDesde: u.encerrada_desde,
    ordem: Number(u.ordem),
  };
}

/** Grava (ou troca) o total do mês. `valor` null apaga o lançamento; 0 é número válido. */
export async function gravarTotal(
  unidadeId: string,
  ano: number,
  mes: number,
  valor: number | null,
  userId: string,
  ex: Exec = db,
): Promise<void> {
  if (valor === null) {
    await ex.execute(sql`
      DELETE FROM faturamento_lancamento
       WHERE unidade_id = ${unidadeId}::uuid AND ano = ${ano}::int AND mes = ${mes}::int
         AND tipo = 'TOTAL'
    `);
    return;
  }
  await ex.execute(sql`
    INSERT INTO faturamento_lancamento (unidade_id, ano, mes, tipo, valor, origem, criado_por)
    VALUES (${unidadeId}::uuid, ${ano}::int, ${mes}::int, 'TOTAL', ${valor.toFixed(2)}::numeric,
            'manual', ${userId}::uuid)
    ON CONFLICT (unidade_id, ano, mes) WHERE tipo = 'TOTAL'
    DO UPDATE SET valor = excluded.valor, origem = 'manual',
                  criado_por = excluded.criado_por, atualizado_em = now()
  `);
}

/** Evento/festa fora do PDV: sempre uma linha nova (pode ter vários no mês). */
export async function criarEvento(
  unidadeId: string,
  ano: number,
  mes: number,
  valor: number,
  observacao: string | null,
  userId: string,
  ex: Exec = db,
): Promise<string> {
  const rows = (await ex.execute(sql`
    INSERT INTO faturamento_lancamento (unidade_id, ano, mes, tipo, valor, observacao, origem, criado_por)
    VALUES (${unidadeId}::uuid, ${ano}::int, ${mes}::int, 'EXTRA', ${valor.toFixed(2)}::numeric,
            ${observacao ?? ''}::text, 'manual', ${userId}::uuid)
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

/** Apaga um evento — só se for EXTRA e de unidade desta organização. */
export async function excluirEvento(id: string, orgId: string, ex: Exec = db): Promise<boolean> {
  const rows = (await ex.execute(sql`
    DELETE FROM faturamento_lancamento l
     USING faturamento_unidade u
     WHERE l.id = ${id}::uuid AND l.tipo = 'EXTRA'
       AND u.id = l.unidade_id AND u.organizacao_id = ${orgId}::uuid
    RETURNING l.id
  `)) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/** Nome sem acento, sem maiúscula e sem espaço sobrando — pra achar unidade repetida. */
function chaveNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Unidade nova no VGV. Com `filialId`, o PDV responde de `sistemaDesde` em
 * diante; sem, é unidade de fora (só lançamento). Devolve o id, ou o motivo.
 */
export async function criarUnidade(
  orgId: string,
  nome: string,
  filialId: string | null,
  sistemaDesde: string | null,
  ex: Exec = db,
): Promise<{ id: string } | { erro: 'nome-repetido' | 'filial-em-uso' | 'filial-de-fora' }> {
  // "aquaarena" e "AquaArena", "Tabuara" e "Tabuará": é a mesma unidade. A trava
  // do banco só pega o nome idêntico, então a comparação folgada é feita aqui.
  const nomes = (await ex.execute(sql`
    SELECT nome FROM faturamento_unidade WHERE organizacao_id = ${orgId}::uuid
  `)) as unknown as Array<{ nome: string }>;
  if (nomes.some((n) => chaveNome(n.nome) === chaveNome(nome))) return { erro: 'nome-repetido' };
  if (filialId) {
    const f = (await ex.execute(sql`
      SELECT (SELECT count(*) FROM filial
               WHERE id = ${filialId}::uuid AND organizacao_id = ${orgId}::uuid)::int AS da_org,
             (SELECT count(*) FROM faturamento_unidade
               WHERE filial_id = ${filialId}::uuid AND ativa)::int AS em_uso
    `)) as unknown as Array<{ da_org: number; em_uso: number }>;
    if (!f[0] || Number(f[0].da_org) === 0) return { erro: 'filial-de-fora' };
    if (Number(f[0].em_uso) > 0) return { erro: 'filial-em-uso' };
  }
  const desde = filialId && sistemaDesde ? `${sistemaDesde}-01` : '';
  const rows = (await ex.execute(sql`
    INSERT INTO faturamento_unidade (organizacao_id, nome, filial_id, sistema_desde, ordem)
    VALUES (${orgId}::uuid, ${nome}::text, NULLIF(${filialId ?? ''}::text, '')::uuid,
            NULLIF(${desde}::text, '')::date,
            (SELECT coalesce(max(ordem), 0) + 1 FROM faturamento_unidade
              WHERE organizacao_id = ${orgId}::uuid))
    ON CONFLICT (organizacao_id, nome) DO NOTHING
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows[0] ? { id: rows[0].id } : { erro: 'nome-repetido' };
}

/** Casas da organização que ainda não somam no VGV (pra oferecer no "nova unidade"). */
export async function filiaisForaDoVgv(
  orgId: string,
  ex: Exec = db,
): Promise<Array<{ id: string; nome: string }>> {
  return (await ex.execute(sql`
    SELECT f.id, f.nome
      FROM filial f
     WHERE f.organizacao_id = ${orgId}::uuid
       AND NOT EXISTS (SELECT 1 FROM faturamento_unidade u WHERE u.filial_id = f.id AND u.ativa)
     ORDER BY f.nome
  `)) as unknown as Array<{ id: string; nome: string }>;
}

/** Marca (ou desmarca, com null) o mês em que a unidade parou de operar. */
export async function marcarEncerrada(
  unidadeId: string,
  desde: string | null,
  ex: Exec = db,
): Promise<void> {
  const d = desde ? `${desde}-01` : '';
  await ex.execute(sql`
    UPDATE faturamento_unidade
       SET encerrada_desde = NULLIF(${d}::text, '')::date
     WHERE id = ${unidadeId}::uuid
  `);
}
