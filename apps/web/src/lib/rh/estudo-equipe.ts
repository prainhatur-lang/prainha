// Estudo de equipe do mês (pedido do dono 10/11/2026): "a tabela de horário
// com relação às vendas, produção e a quantidade de funcionários trabalhando".
// Tudo calculado na hora, só leitura, por casa e por mês:
//  - ponto (pares entrada/saída) espalhado hora a hora no dia operacional
//    (vira às 05:00) e separado por grupo: salão, bar, caixa, cozinha,
//    limpeza, gestão/outros. A hora conta na casa onde a pessoa BATEU;
//  - venda hora a hora pelos itens lançados (sem os 10%) e pratos da cozinha
//    pela área de produção do produto;
//  - atendimento (salão + bar + caixa): o necessário de cada hora é a venda
//    dividida pela produtividade-meta (padrão: o que a casa já faz nas 25%
//    horas mais produtivas do mês), nunca abaixo do mínimo; uma hora antes
//    e uma depois do serviço contam como abertura/fechamento (mínimo);
//  - cozinha se mede pela produção também (regra do dono 10/10/2026): hora
//    de cozinha fora do serviço é produção, não sobra; excesso só por
//    tendência (horas subindo com pratos caindo), sempre como pergunta;
//  - dia típico = sem feriado e sem venda acima de 1,8× a mediana do mesmo
//    dia da semana (evento/feriado não puxa a média);
//  - por pessoa: horas, dias, h/dia, dias por semana, % no fim de semana,
//    dias longos e custo estimado → sinais de regime (intermitente que já
//    passou do empate com o fixo, CLT só de fim de semana, perfil de
//    diarista 2 dias, 12x36, sobra de escala, hora extra, acima de 10 h).
// São base pro gerente decidir, não decisão automática.

import { db } from '@concilia/db';
import { sql, type SQL } from 'drizzle-orm';
import { calcularDia } from '@/lib/rh/calcular-ponto';
import { pontoProprioDesde } from '@/lib/rh/ponto-vigencia';
import { somarDias } from '@/lib/rh/dia-operacional';
import { comRegimeDoMes } from '@/lib/rh/regime-no-mes';
import { proximosFeriados } from '@/lib/reservas/feriados';
import { FATOR_CLT, FATOR_INTERMITENTE } from '@/lib/rh/horas-regime';
import { custoRealDaCasa, custoCasa, PAGO_ZERO, type Pago, type PagoSemPonto } from '@/lib/rh/custo-real-equipe';

async function q<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Custo por hora-pessoa quando a pessoa não tem regime/valor no cadastro (estimativa). */
export const CUSTO_HORA_ESTIMADO = 12;
/** Piso da CCT SINDHOTRE 2026/2028. */
export const PISO_CCT = 1670;
/** Mês cheio de CLT (44 h/semana). */
export const HORAS_CLT_MES = 220;
/** Um turno pra converter sobra/falta de horas em "pessoas-turno". */
export const HORAS_TURNO = 8;

export const GRUPOS = ['salao', 'bar', 'caixa', 'cozinha', 'limpeza', 'outros'] as const;
export type Grupo = (typeof GRUPOS)[number];
export const NOME_GRUPO: Record<Grupo, string> = {
  salao: 'Salão',
  bar: 'Bar',
  caixa: 'Caixa',
  cozinha: 'Cozinha',
  limpeza: 'Limpeza',
  outros: 'Gestão/outros',
};
const ATEND: Grupo[] = ['salao', 'bar', 'caixa'];

export const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** slot 0 = 05h … slot 23 = 04h do dia seguinte. */
export const horaDoSlot = (s: number) => (s + 5) % 24;

export function grupoDe(setor: string | null, cargo: string | null): Grupo {
  const c = (cargo ?? '').toLowerCase();
  const s = (setor ?? '').toUpperCase();
  if (/caixa/.test(c)) return 'caixa';
  if (s === 'COZINHA' || s === 'PRODUCAO' || /cozinh|chapeir|pizzai|churrasq|sushi|confeit|padeir|chef/.test(c)) return 'cozinha';
  if (s === 'BAR' || /barm|bartend|barista|\bbar\b/.test(c)) return 'bar';
  if (s === 'LIMPEZA' || /limpez|servi[cç]os gerais|\basg\b|zelad/.test(c)) return 'limpeza';
  if (s === 'ADM' || s === 'LOGISTICA' || /gerent|admin|compr|estoqu|motorist|financ|supervis|encarreg|recep/.test(c)) return 'outros';
  return 'salao';
}

const ehCozinhaArea = (nome: string) => /coz|principal|entrada|sobremesa|pastel|petisco|cozinha/i.test(nome);

export interface OpcoesEstudo {
  /** R$ por hora-pessoa de atendimento (salão+bar+caixa). Padrão: P75 do mês. */
  metaAtend?: number | null;
  /** Pratos por hora-cozinheiro em serviço. Padrão: P75 do mês. */
  metaCoz?: number | null;
  /** Mínimo de pessoas no atendimento com a casa aberta. Padrão 2. */
  minAtend?: number | null;
}

export interface SlotMedia {
  slot: number;
  venda: number;
  itensCoz: number;
  atend: number; // pessoas-equivalentes médias
  cozinha: number;
  limpeza: number;
  outros: number;
  necAtend: number;
  necCoz: number; // só no serviço; fora = produção
  servico: boolean; // tem venda na média
}

export interface LinhaDow {
  dow: number;
  dias: number; // dias típicos
  diasTodos: number;
  venda: number; // média dia típico
  itensCoz: number;
  hAtend: number;
  hNecAtend: number;
  hCoz: number;
  hCozServico: number;
  hCozProducao: number;
  hLimpeza: number;
  hOutros: number;
  picoAtend: number; // maior pessoas-equivalentes médio numa hora
  slots: SlotMedia[];
}

export interface DiaEstudo {
  dia: string;
  dow: number;
  feriado: string | null;
  atipico: boolean;
  venda: number;
  itensCoz: number;
  pedidos: number;
  h: Record<Grupo, number>;
  hNecAtend: number;
  sobraAtend: number; // horas acima do necessário (≥0)
  faltaAtend: number; // horas abaixo do necessário (≥0)
  hCozServico: number;
  hCozProducao: number;
  pessoas: number;
}

export type TipoSinal =
  | 'virar_clt'
  | 'fim_de_semana'
  | 'diarista_2dias'
  | 'doze_36'
  | 'sobra_escala'
  | 'hora_extra'
  | 'acima_10h'
  | 'sem_valor';

export interface Sinal {
  tipo: TipoSinal;
  texto: string;
}

export interface PessoaEstudo {
  id: string;
  nome: string;
  cargo: string | null;
  grupo: Grupo;
  regime: 'clt' | 'intermitente' | 'diarista' | 'sem_regime';
  valor: number | null; // salário (CLT) ou R$/h
  daCasa: boolean;
  hCasa: number;
  hTotal: number; // todas as casas
  dias: number; // dias com batida nesta casa
  diasTotal: number;
  hDia: number;
  diasSemana: number;
  pctFds: number; // 0–1 dos dias nesta casa em sex/sáb/dom
  diasLongos: number; // ≥ 10 h
  maxDiaH: number;
  porDow: number[]; // dias nesta casa por dia da semana
  horasMes30: number; // horas em todas as casas levadas a 30 dias
  custo: number; // nesta casa, no período
  custoEstimado: boolean;
  empateH: number | null; // horas/mês em que o intermitente custa igual ao fixo
  sinais: Sinal[];
  /** Entrada e saída mais comuns nesta casa (mediana), ex.: "10:00–18:30". */
  horarioTipico: string | null;
  /** Registrado no mês (empresa de registro no cadastro e não é diarista). */
  registrado?: boolean;
  /** O que a casa lançou pra pessoa no período (folha do mês, diária, bonificação, transporte, 10%). */
  pago?: Pago | null;
}

export interface GrupoCustoReal {
  pessoas: number;
  horas: number;
  pago: Pago;
}

/** Custo pelo que foi lançado de verdade, separado por registrado × não registrado. */
export interface CustoRealResumo {
  registrados: GrupoCustoReal;
  naoRegistrados: GrupoCustoReal;
  /** Recebeu da casa no período e não bateu ponto nela. */
  semPonto: PagoSemPonto[];
  /** Bateu ponto na casa e não tem nenhum lançamento no período. */
  pontoSemPagamento: { nome: string; horas: number; registrado: boolean }[];
  /** Sai do bolso da casa (salário + encargos + diária + bonificação + transporte), com quem não bateu ponto. */
  custo: number;
  custoPctVenda: number;
  /** 10% repassado à equipe (pago pelo cliente — fora do custo). */
  dezPct: number;
}

export interface ResumoMes {
  mes: string;
  ini: string;
  fim: string;
  dias: number;
  parcial: boolean;
  venda: number;
  itensCoz: number;
  pedidos: number;
  h: Record<Grupo, number>;
  hAtend: number;
  hTotal: number;
  hNecAtend: number;
  sobraAtend: number;
  faltaAtend: number;
  hCozServico: number;
  hCozProducao: number;
  vendaPorHAtend: number;
  itensPorHCoz: number;
  custo: number;
  custoPctVenda: number;
  pessoas: number;
  ordensProducao: number;
}

export interface EstudoEquipe {
  filialId: string;
  mes: string;
  resumo: ResumoMes;
  anteriores: ResumoMes[];
  metas: {
    atend: number;
    coz: number;
    minAtend: number;
    atendP50: number;
    atendP75: number;
    atendP90: number;
    cozP50: number;
    cozP75: number;
    cozP90: number;
    padrao: boolean;
  };
  dows: LinhaDow[];
  dias: DiaEstudo[];
  pessoas: PessoaEstudo[];
  achados: string[];
  avisos: string[];
  custoReal?: CustoRealResumo;
}

function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
const mediana = (arr: number[]) => pct(arr, 0.5);
const dowDe = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay();
const vazioG = (): Record<Grupo, number> => ({ salao: 0, bar: 0, caixa: 0, cozinha: 0, limpeza: 0, outros: 0 });
const z24 = () => new Array<number>(24).fill(0);

/** Primeiro e último dia do mês 'YYYY-MM', cortando em ontem e na virada do ponto próprio. */
export function periodoDoMes(filialId: string, mes: string, hoje: string): { ini: string; fim: string; parcial: boolean } | null {
  const ini0 = `${mes}-01`;
  const [y, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const ontem = somarDias(hoje, -1);
  const virada = pontoProprioDesde(filialId);
  const ini = ini0 < virada ? virada : ini0;
  const fim = ultimo > ontem ? ontem : ultimo;
  if (fim < ini) return null;
  return { ini, fim, parcial: fim < ultimo || ini > ini0 };
}

/** Meses que dá pra estudar (do ponto próprio da casa em diante), mais recente primeiro. */
export function mesesDisponiveis(filialId: string, hoje: string): string[] {
  const out: string[] = [];
  let [y, m] = somarDias(hoje, -1).slice(0, 7).split('-').map(Number);
  for (let i = 0; i < 12; i++) {
    const mes = `${y}-${String(m).padStart(2, '0')}`;
    if (!periodoDoMes(filialId, mes, hoje)) break;
    out.push(mes);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function mesAnterior(mes: string, n = 1): string {
  let [y, m] = mes.split('-').map(Number);
  m -= n;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

interface Base {
  ini: string;
  fim: string;
  parcial: boolean;
  dias: string[];
  feriados: Map<string, string>;
  /** dia → grupo → 24 slots de horas-pessoa (nesta casa). */
  horasSlot: Map<string, Record<Grupo, number[]>>;
  /** dia → 24 slots de venda / pratos / pedidos. */
  vendaSlot: Map<string, number[]>;
  cozSlot: Map<string, number[]>;
  pedidosDia: Map<string, number>;
  /** funcionario → dia → { casa: minutos nesta casa, total: em todas } */
  minPessoa: Map<string, Map<string, { casa: number; total: number }>>;
  pessoasDia: Map<string, Set<string>>;
  /** funcionario → [entrada, saída] do dia nesta casa, em minutos desde 05:00. */
  turnoPessoa: Map<string, [number, number][]>;
  cadastro: Map<string, CadRow>;
  ordensProducao: number;
}

interface CadRow {
  id: string;
  nome: string;
  cargo: string | null;
  setor: string | null;
  filial_id: string;
  regime: string | null;
  salario_base: string | null;
  ativo: boolean;
  diarista: boolean;
  admissao: string | null;
  demissao: string | null;
}

async function carregarBase(filialId: string, ini: string, fim: string, parcial: boolean): Promise<Base> {
  const tsIni = `${ini}T05:00:00-03:00`;
  const tsFim = `${somarDias(fim, 1)}T05:00:00-03:00`;
  const [batidas, cadRows, vendas, coz, pedidos, ops, feriadosL] = await Promise.all([
    q<{ funcionario_id: string; filial_id: string; dia: string; quando: Date; tipo: string }>(sql`
      SELECT funcionario_id, filial_id, dia_operacional::text AS dia, quando, tipo
        FROM ponto_batida
       WHERE excluida_em IS NULL AND dia_operacional BETWEEN ${ini}::date AND ${fim}::date`),
    q<CadRow>(sql`
      SELECT id, nome, cargo, setor, filial_id, regime_salarial AS regime, salario_base, ativo,
             data_admissao::text AS admissao, data_desligamento::text AS demissao,
             EXISTS (SELECT 1 FROM fornecedor_folha ff WHERE ff.fornecedor_id = funcionario.fornecedor_id AND ff.papel = 'diarista')
             AND NOT EXISTS (SELECT 1 FROM fornecedor_folha ff WHERE ff.fornecedor_id = funcionario.fornecedor_id AND ff.papel <> 'diarista') AS diarista
        FROM funcionario`),
    // Venda pela hora do lançamento do item (item principal; sem os 10%).
    q<{ dia: string; slot: number; total: number }>(sql`
      SELECT ((i.data_hora_cadastro AT TIME ZONE 'America/Sao_Paulo') - interval '5 hours')::date::text AS dia,
             extract(hour from (i.data_hora_cadastro AT TIME ZONE 'America/Sao_Paulo') - interval '5 hours')::int AS slot,
             coalesce(sum(i.valor_total), 0)::float8 AS total
        FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id
       WHERE i.filial_id = ${filialId} AND i.data_delete IS NULL AND p.data_delete IS NULL AND i.codigo_pai IS NULL
         AND i.data_hora_cadastro >= ${tsIni}::timestamptz AND i.data_hora_cadastro < ${tsFim}::timestamptz
       GROUP BY 1, 2`),
    // Pratos: quantidade de itens cujo produto sai numa área de cozinha.
    q<{ dia: string; slot: number; qtd: number; area: string }>(sql`
      SELECT ((i.data_hora_cadastro AT TIME ZONE 'America/Sao_Paulo') - interval '5 hours')::date::text AS dia,
             extract(hour from (i.data_hora_cadastro AT TIME ZONE 'America/Sao_Paulo') - interval '5 hours')::int AS slot,
             coalesce(sum(i.quantidade), 0)::float8 AS qtd, a.nome AS area
        FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id
        JOIN produto pr ON pr.id = i.produto_id
        JOIN area_producao a ON a.filial_id = i.filial_id AND a.codigo_externo = pr.codigo_cozinha
       WHERE i.filial_id = ${filialId} AND i.data_delete IS NULL AND p.data_delete IS NULL
         AND i.data_hora_cadastro >= ${tsIni}::timestamptz AND i.data_hora_cadastro < ${tsFim}::timestamptz
       GROUP BY 1, 2, 4`),
    q<{ dia: string; n: number }>(sql`
      SELECT ((data_abertura AT TIME ZONE 'America/Sao_Paulo') - interval '5 hours')::date::text AS dia, count(*)::int AS n
        FROM pedido
       WHERE filial_id = ${filialId} AND data_delete IS NULL
         AND data_abertura >= ${tsIni}::timestamptz AND data_abertura < ${tsFim}::timestamptz
       GROUP BY 1`),
    q<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ordem_producao
       WHERE filial_id = ${filialId} AND data_hora >= ${tsIni}::timestamptz AND data_hora < ${tsFim}::timestamptz`),
    proximosFeriados(ini, Math.round((Date.parse(fim) - Date.parse(ini)) / 86400000)).catch(() => []),
  ]);

  const dias: string[] = [];
  for (let d = ini; d <= fim; d = somarDias(d, 1)) dias.push(d);
  const feriados = new Map(feriadosL.map((f) => [f.data, f.nome]));
  const cadastro = new Map(cadRows.map((c) => [c.id, c]));

  const grupos = new Map<string, { quando: Date; tipo: 'entrada' | 'saida' }[]>();
  for (const b of batidas) {
    if (b.dia < pontoProprioDesde(b.filial_id)) continue;
    const k = `${b.funcionario_id}|${b.dia}|${b.filial_id}`;
    const l = grupos.get(k) ?? [];
    l.push({ quando: new Date(b.quando), tipo: b.tipo as 'entrada' | 'saida' });
    grupos.set(k, l);
  }

  const horasSlot = new Map<string, Record<Grupo, number[]>>();
  const minPessoa = new Map<string, Map<string, { casa: number; total: number }>>();
  const pessoasDia = new Map<string, Set<string>>();
  const turnoPessoa = new Map<string, [number, number][]>();
  for (const [k, l] of grupos) {
    const [fid, dia, casa] = k.split('|');
    const calc = calcularDia(l);
    if (calc.totalMin <= 0) continue;
    const porDia = minPessoa.get(fid) ?? new Map<string, { casa: number; total: number }>();
    const at = porDia.get(dia) ?? { casa: 0, total: 0 };
    at.total += calc.totalMin;
    if (casa === filialId) at.casa += calc.totalMin;
    porDia.set(dia, at);
    minPessoa.set(fid, porDia);
    if (casa !== filialId) continue;
    const ps = pessoasDia.get(dia) ?? new Set<string>();
    ps.add(fid);
    pessoasDia.set(dia, ps);
    const cad = cadastro.get(fid);
    const g = grupoDe(cad?.setor ?? null, cad?.cargo ?? null);
    const hs = horasSlot.get(dia) ?? { salao: z24(), bar: z24(), caixa: z24(), cozinha: z24(), limpeza: z24(), outros: z24() };
    const base = Date.parse(`${dia}T05:00:00-03:00`);
    const e0 = Math.min(...calc.pares.map((p) => Date.parse(p.entrada)).filter(Number.isFinite));
    const s0 = Math.max(...calc.pares.map((p) => Date.parse(p.saida)).filter(Number.isFinite));
    if (Number.isFinite(e0) && Number.isFinite(s0) && s0 > e0) {
      const tl = turnoPessoa.get(fid) ?? [];
      tl.push([(e0 - base) / 60000, (s0 - base) / 60000]);
      turnoPessoa.set(fid, tl);
    }
    for (const p of calc.pares) {
      let t = Date.parse(p.entrada);
      const t1 = Date.parse(p.saida);
      if (!Number.isFinite(t) || !Number.isFinite(t1)) continue;
      while (t < t1) {
        const off = t - base;
        const slot = Math.floor(off / 3600000);
        if (slot < 0 || slot > 23) break;
        const fimSlot = base + (slot + 1) * 3600000;
        const ate = Math.min(fimSlot, t1);
        hs[g][slot] += (ate - t) / 3600000;
        t = ate;
      }
    }
    horasSlot.set(dia, hs);
  }

  const vendaSlot = new Map<string, number[]>();
  for (const v of vendas) {
    const a = vendaSlot.get(v.dia) ?? z24();
    if (v.slot >= 0 && v.slot < 24) a[v.slot] += num(v.total);
    vendaSlot.set(v.dia, a);
  }
  const cozSlot = new Map<string, number[]>();
  for (const c of coz) {
    if (!ehCozinhaArea(c.area)) continue;
    const a = cozSlot.get(c.dia) ?? z24();
    if (c.slot >= 0 && c.slot < 24) a[c.slot] += num(c.qtd);
    cozSlot.set(c.dia, a);
  }
  return {
    ini,
    fim,
    parcial,
    dias,
    feriados,
    horasSlot,
    vendaSlot,
    cozSlot,
    pedidosDia: new Map(pedidos.map((p) => [p.dia, num(p.n)])),
    minPessoa,
    pessoasDia,
    turnoPessoa,
    cadastro,
    ordensProducao: num(ops[0]?.n),
  };
}

/** Dias atípicos: feriado ou venda > 1,8× a mediana do mesmo dia da semana. */
function marcarAtipicos(b: Base): Map<string, boolean> {
  const vendaDia = (d: string) => (b.vendaSlot.get(d) ?? []).reduce((s, x) => s + x, 0);
  const porDow = new Map<number, number[]>();
  for (const d of b.dias) {
    if (b.feriados.has(d)) continue;
    const l = porDow.get(dowDe(d)) ?? [];
    l.push(vendaDia(d));
    porDow.set(dowDe(d), l);
  }
  const out = new Map<string, boolean>();
  for (const d of b.dias) {
    const med = mediana(porDow.get(dowDe(d)) ?? []);
    out.set(d, b.feriados.has(d) || (med > 0 && vendaDia(d) > 1.8 * med));
  }
  return out;
}

/** Janela de serviço do dia: do primeiro ao último slot com venda. */
function janela(venda: number[]): [number, number] | null {
  let a = -1;
  let z = -1;
  for (let s = 0; s < 24; s++) {
    if (venda[s] > 0) {
      if (a < 0) a = s;
      z = s;
    }
  }
  return a < 0 ? null : [a, z];
}

function produtividades(b: Base, atip: Map<string, boolean>) {
  const atend: number[] = [];
  const coz: number[] = [];
  for (const d of b.dias) {
    if (atip.get(d)) continue;
    const v = b.vendaSlot.get(d);
    const h = b.horasSlot.get(d);
    if (!v || !h) continue;
    const c = b.cozSlot.get(d) ?? z24();
    for (let s = 0; s < 24; s++) {
      const pa = ATEND.reduce((x, g) => x + h[g][s], 0);
      if (v[s] > 0 && pa >= 0.5) atend.push(v[s] / pa);
      if (c[s] > 0 && h.cozinha[s] >= 0.5) coz.push(c[s] / h.cozinha[s]);
    }
  }
  return { atend, coz };
}

interface Calc {
  dias: DiaEstudo[];
  slotsDia: Map<string, { necAtend: number[]; necCoz: number[] }>;
}

function calcularDias(b: Base, atip: Map<string, boolean>, metaAtend: number, metaCoz: number, minAtend: number): Calc {
  const dias: DiaEstudo[] = [];
  const slotsDia = new Map<string, { necAtend: number[]; necCoz: number[] }>();
  for (const d of b.dias) {
    const v = b.vendaSlot.get(d) ?? z24();
    const c = b.cozSlot.get(d) ?? z24();
    const h = b.horasSlot.get(d) ?? { salao: z24(), bar: z24(), caixa: z24(), cozinha: z24(), limpeza: z24(), outros: z24() };
    const jan = janela(v);
    const necAtend = z24();
    const necCoz = z24();
    let sobra = 0;
    let falta = 0;
    let cozServ = 0;
    let cozProd = 0;
    for (let s = 0; s < 24; s++) {
      const real = ATEND.reduce((x, g) => x + h[g][s], 0);
      let nec = 0;
      if (jan && s >= jan[0] && s <= jan[1]) nec = Math.max(minAtend, metaAtend > 0 ? v[s] / metaAtend : 0);
      else if (jan && (s === jan[0] - 1 || s === jan[1] + 1)) nec = minAtend;
      necAtend[s] = nec;
      if (real > nec) sobra += real - nec;
      else falta += nec - real;
      if (jan && s >= jan[0] && s <= jan[1]) {
        necCoz[s] = Math.max(1, metaCoz > 0 ? c[s] / metaCoz : 0);
        cozServ += h.cozinha[s];
      } else cozProd += h.cozinha[s];
    }
    slotsDia.set(d, { necAtend, necCoz });
    const hg = vazioG();
    for (const g of GRUPOS) hg[g] = h[g].reduce((x, y) => x + y, 0);
    dias.push({
      dia: d,
      dow: dowDe(d),
      feriado: b.feriados.get(d) ?? null,
      atipico: !!atip.get(d),
      venda: v.reduce((x, y) => x + y, 0),
      itensCoz: c.reduce((x, y) => x + y, 0),
      pedidos: b.pedidosDia.get(d) ?? 0,
      h: hg,
      hNecAtend: necAtend.reduce((x, y) => x + y, 0),
      sobraAtend: sobra,
      faltaAtend: falta,
      hCozServico: cozServ,
      hCozProducao: cozProd,
      pessoas: b.pessoasDia.get(d)?.size ?? 0,
    });
  }
  return { dias, slotsDia };
}

function custoDaHora(regime: PessoaEstudo['regime'], valor: number | null): number | null {
  if (regime === 'intermitente' && valor && valor > 0 && valor < 200) return valor * FATOR_INTERMITENTE;
  if (regime === 'diarista' && valor && valor > 0 && valor < 200) return valor;
  return null;
}

async function calcularPessoas(b: Base, filialId: string): Promise<PessoaEstudo[]> {
  const nDias = b.dias.length;
  const semanas = nDias / 7;
  const ids = [...b.minPessoa.entries()].filter(([, m]) => [...m.values()].some((x) => x.casa > 0)).map(([id]) => id);
  const cads = ids.map((id) => b.cadastro.get(id)).filter((c): c is CadRow => !!c);
  const comRegime = await comRegimeDoMes(
    cads.map((c) => ({ ...c, regimeSalarial: c.regime, salarioBase: c.salario_base })),
    `${b.ini.slice(0, 7)}-01`,
  );
  const out: PessoaEstudo[] = [];
  for (const c of comRegime) {
    const m = b.minPessoa.get(c.id)!;
    let minCasa = 0;
    let minTotal = 0;
    let dias = 0;
    let diasTotal = 0;
    let fds = 0;
    let longos = 0;
    let acima10 = 0;
    let maxDia = 0;
    const porDow = new Array<number>(7).fill(0);
    for (const [dia, x] of m) {
      minTotal += x.total;
      if (x.total > 0) diasTotal++;
      if (x.casa <= 0) continue;
      minCasa += x.casa;
      dias++;
      const dw = dowDe(dia);
      porDow[dw]++;
      if (dw === 0 || dw === 5 || dw === 6) fds++;
      if (x.total >= 600) longos++;
      if (x.total > 615) acima10++;
      maxDia = Math.max(maxDia, x.total);
    }
    const valor = c.salarioBase != null ? num(c.salarioBase) || null : null;
    const regime: PessoaEstudo['regime'] =
      c.regimeSalarial === 'clt_mensal'
        ? 'clt'
        : c.diarista
          ? 'diarista'
          : c.regimeSalarial === 'intermitente_hora'
            ? 'intermitente'
            : 'sem_regime';
    const hCasa = minCasa / 60;
    const hTotal = minTotal / 60;
    const horasMes30 = nDias > 0 ? (hTotal * 30) / nDias : 0;
    // Escala prevista só nos dias em que a pessoa estava contratada.
    const iniC = c.admissao && c.admissao > b.ini ? c.admissao : b.ini;
    const fimC = c.demissao && c.demissao < b.fim ? c.demissao : b.fim;
    // Admissão/desligamento fora do período (recontratação, cadastro atrasado): usa o período todo.
    const diasContratado = fimC >= iniC ? Math.round((Date.parse(fimC) - Date.parse(iniC)) / 86400000) + 1 : nDias;
    const previstoCLT = (HORAS_CLT_MES * diasContratado) / 30;
    const diasSemanaTotal = semanas > 0 ? diasTotal / semanas : 0;
    let custo = 0;
    let estimado = false;
    if (regime === 'clt' && valor && valor >= 500) {
      // Salário do período (proporcional aos dias) dividido pelas casas onde bateu.
      custo = valor * FATOR_CLT * (diasContratado / 30) * (hTotal > 0 ? hCasa / hTotal : 1);
    } else {
      const ch = custoDaHora(regime, valor);
      if (ch) custo = ch * hCasa;
      else {
        custo = CUSTO_HORA_ESTIMADO * hCasa;
        estimado = true;
      }
    }
    let empateH: number | null = null;
    if (regime === 'intermitente' && valor && valor > 0 && valor < 200) {
      const fixo = Math.max(PISO_CCT, valor * HORAS_CLT_MES * 0.85) * FATOR_CLT;
      empateH = fixo / (valor * FATOR_INTERMITENTE);
    }
    const diasSemana = semanas > 0 ? dias / semanas : 0;
    const pctFds = dias > 0 ? fds / dias : 0;
    const hDia = dias > 0 ? hCasa / dias : 0;
    const sinais: Sinal[] = [];
    if (regime === 'intermitente' && empateH && horasMes30 > empateH)
      sinais.push({
        tipo: 'virar_clt',
        texto: `Intermitente no ritmo de ${Math.round(horasMes30)} h/mês${hTotal > hCasa + 1 ? ' (somando as casas)' : ''}, acima do empate (~${Math.round(empateH)} h): como fixo sairia mais barato.`,
      });
    if (regime === 'clt' && dias >= 3 && pctFds >= 0.7 && diasSemana <= 3.2)
      sinais.push({
        tipo: 'fim_de_semana',
        texto: `CLT que trabalha ${Math.round(pctFds * 100)}% dos dias em sex–dom (${r1(diasSemana)} dias/semana): perfil de intermitente ou diarista de fim de semana.`,
      });
    if (regime !== 'clt' && dias >= 2 && diasSemanaTotal <= 2.2)
      sinais.push({
        tipo: 'diarista_2dias',
        texto: `Vem ${r1(diasSemana)} dia(s) por semana: cabe como diarista de 2 dias (até 2 por semana, fora da folha).`,
      });
    if (dias >= 4 && longos / dias >= 0.4 && diasSemana >= 3 && diasSemana <= 4.2)
      sinais.push({
        tipo: 'doze_36',
        texto: `${longos} de ${dias} dias com 10 h ou mais, ${r1(diasSemana)} dias/semana: o desenho já parece 12x36.`,
      });
    if (regime === 'clt' && hTotal < 0.8 * previstoCLT && diasContratado >= 14 && !c.demissao)
      sinais.push({
        tipo: 'sobra_escala',
        texto: `CLT com ${Math.round(hTotal)} h de ~${Math.round(previstoCLT)} h previstas no período (${Math.round((hTotal / previstoCLT) * 100)}%): falta ou escala curta, hora paga sem uso.`,
      });
    if (regime === 'clt' && hTotal > 1.1 * previstoCLT && diasContratado >= 14)
      sinais.push({
        tipo: 'hora_extra',
        texto: `CLT com ${Math.round(hTotal)} h para ~${Math.round(previstoCLT)} h previstas: ${Math.round(hTotal - previstoCLT)} h além da escala (hora extra 50% ou banco).`,
      });
    if (acima10 >= 2)
      sinais.push({
        tipo: 'acima_10h',
        texto: `${acima10} dia(s) acima de 10 h (máximo ${r1(maxDia / 60)} h): a CCT limita a 10 h (8 + 2 extras).`,
      });
    if (estimado)
      sinais.push({ tipo: 'sem_valor', texto: `Sem regime/valor no cadastro: custo estimado a R$ ${CUSTO_HORA_ESTIMADO}/h.` });
    out.push({
      id: c.id,
      nome: c.nome,
      cargo: c.cargo,
      grupo: grupoDe(c.setor, c.cargo),
      regime,
      valor,
      daCasa: c.filial_id === filialId && c.ativo,
      hCasa: r1(hCasa),
      hTotal: r1(hTotal),
      dias,
      diasTotal,
      hDia: r1(hDia),
      diasSemana: r1(diasSemana),
      pctFds: Math.round(pctFds * 100) / 100,
      diasLongos: longos,
      maxDiaH: r1(maxDia / 60),
      porDow,
      horasMes30: Math.round(horasMes30),
      custo: Math.round(custo),
      custoEstimado: estimado,
      empateH: empateH ? Math.round(empateH) : null,
      sinais,
      horarioTipico: horarioTipico(b.turnoPessoa.get(c.id) ?? []),
    });
  }
  out.sort((a, b2) => GRUPOS.indexOf(a.grupo) - GRUPOS.indexOf(b2.grupo) || b2.hCasa - a.hCasa);
  return out;
}

const hhmm = (minDesde5: number) => {
  const t = Math.round((minDesde5 + 300) / 15) * 15;
  const h = Math.floor(t / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
function horarioTipico(l: [number, number][]): string | null {
  if (!l.length) return null;
  return `${hhmm(mediana(l.map((x) => x[0])))}–${hhmm(mediana(l.map((x) => x[1])))}`;
}

function resumir(mes: string, b: Base, dias: DiaEstudo[], pessoas: PessoaEstudo[] | null): ResumoMes {
  const h = vazioG();
  let venda = 0, itens = 0, ped = 0, nec = 0, sobra = 0, falta = 0, cs = 0, cp = 0;
  for (const d of dias) {
    for (const g of GRUPOS) h[g] += d.h[g];
    venda += d.venda;
    itens += d.itensCoz;
    ped += d.pedidos;
    nec += d.hNecAtend;
    sobra += d.sobraAtend;
    falta += d.faltaAtend;
    cs += d.hCozServico;
    cp += d.hCozProducao;
  }
  const hAtend = ATEND.reduce((x, g) => x + h[g], 0);
  const hTotal = GRUPOS.reduce((x, g) => x + h[g], 0);
  const custo = pessoas ? pessoas.reduce((x, p) => x + p.custo, 0) : hTotal * CUSTO_HORA_ESTIMADO;
  const ids = new Set<string>();
  for (const s of b.pessoasDia.values()) for (const x of s) ids.add(x);
  return {
    mes,
    ini: b.ini,
    fim: b.fim,
    dias: b.dias.length,
    parcial: b.parcial,
    venda,
    itensCoz: itens,
    pedidos: ped,
    h,
    hAtend,
    hTotal,
    hNecAtend: nec,
    sobraAtend: sobra,
    faltaAtend: falta,
    hCozServico: cs,
    hCozProducao: cp,
    vendaPorHAtend: hAtend > 0 ? venda / hAtend : 0,
    itensPorHCoz: cs > 0 ? itens / cs : 0,
    custo,
    custoPctVenda: venda > 0 ? custo / venda : 0,
    pessoas: ids.size,
    ordensProducao: b.ordensProducao,
  };
}

function montarDows(b: Base, calc: Calc): LinhaDow[] {
  const out: LinhaDow[] = [];
  for (let dw = 0; dw < 7; dw++) {
    const todos = calc.dias.filter((d) => d.dow === dw);
    const tip = todos.filter((d) => !d.atipico);
    const n = tip.length;
    const slots: SlotMedia[] = [];
    for (let s = 0; s < 24; s++) {
      let venda = 0, it = 0, at = 0, cz = 0, lp = 0, ou = 0, na = 0, nc = 0;
      for (const d of tip) {
        const v = b.vendaSlot.get(d.dia);
        const c = b.cozSlot.get(d.dia);
        const h = b.horasSlot.get(d.dia);
        const sd = calc.slotsDia.get(d.dia);
        venda += v?.[s] ?? 0;
        it += c?.[s] ?? 0;
        if (h) {
          at += ATEND.reduce((x, g) => x + h[g][s], 0);
          cz += h.cozinha[s];
          lp += h.limpeza[s];
          ou += h.outros[s];
        }
        na += sd?.necAtend[s] ?? 0;
        nc += sd?.necCoz[s] ?? 0;
      }
      const k = n || 1;
      slots.push({
        slot: s,
        venda: venda / k,
        itensCoz: it / k,
        atend: at / k,
        cozinha: cz / k,
        limpeza: lp / k,
        outros: ou / k,
        necAtend: na / k,
        necCoz: nc / k,
        servico: venda > 0,
      });
    }
    const med = (f: (d: DiaEstudo) => number) => (n ? tip.reduce((x, d) => x + f(d), 0) / n : 0);
    out.push({
      dow: dw,
      dias: n,
      diasTodos: todos.length,
      venda: med((d) => d.venda),
      itensCoz: med((d) => d.itensCoz),
      hAtend: med((d) => ATEND.reduce((x, g) => x + d.h[g], 0)),
      hNecAtend: med((d) => d.hNecAtend),
      hCoz: med((d) => d.h.cozinha),
      hCozServico: med((d) => d.hCozServico),
      hCozProducao: med((d) => d.hCozProducao),
      hLimpeza: med((d) => d.h.limpeza),
      hOutros: med((d) => d.h.outros),
      picoAtend: Math.max(0, ...slots.map((x) => x.atend)),
      slots,
    });
  }
  // Semana começando na segunda.
  return [...out.slice(1), out[0]];
}

const brl0 = (v: number) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');

function achadosDe(e: Omit<EstudoEquipe, 'achados' | 'avisos'>): { achados: string[]; avisos: string[] } {
  const a: string[] = [];
  const av: string[] = [];
  const r = e.resumo;
  const fator30 = r.dias > 0 ? 30 / r.dias : 0;
  const tip = e.dias.filter((d) => !d.atipico);
  const sobraTip = tip.reduce((x, d) => x + d.sobraAtend, 0);
  const faltaTip = tip.reduce((x, d) => x + d.faltaAtend, 0);
  const custoHAtend = (() => {
    const at = e.pessoas.filter((p) => ATEND.includes(p.grupo));
    const h = at.reduce((x, p) => x + p.hCasa, 0);
    return h > 0 ? at.reduce((x, p) => x + p.custo, 0) / h : CUSTO_HORA_ESTIMADO;
  })();

  a.push(
    `Atendimento (salão + bar + caixa): ${Math.round(r.hAtend)} h no período para ${brl0(r.venda)} de venda = ${brl0(r.vendaPorHAtend)} por hora-pessoa. A meta usada é ${brl0(e.metas.atend)}/h${e.metas.padrao ? ' (o que a casa já faz nas 25% horas mais produtivas)' : ' (ajustada na tela)'} com mínimo de ${e.metas.minAtend} pessoa(s) com a casa aberta.`,
  );
  if (sobraTip > 0)
    a.push(
      `Nos dias típicos, o atendimento ficou ${Math.round(sobraTip)} h acima do necessário (≈ ${Math.round((sobraTip * fator30) / HORAS_TURNO)} turnos de 8 h por mês, ≈ ${brl0(sobraTip * fator30 * custoHAtend)}/mês a ${brl0(custoHAtend)}/h). É o teto do que dá pra enxugar mantendo a meta — não é tudo corte: troca de turno e pico curto pedem folga.`,
    );
  if (faltaTip > 0.5)
    a.push(`Faltou gente em ${Math.round(faltaTip)} h (venda acima do que a equipe da hora rende na meta). Ver os dias/horas em vermelho antes de cortar.`);

  const dows = e.dows.filter((d) => d.dias > 0);
  const piorSobra = [...dows].sort((x, y) => y.hAtend - y.hNecAtend - (x.hAtend - x.hNecAtend))[0];
  if (piorSobra && piorSobra.hAtend - piorSobra.hNecAtend > 4)
    a.push(
      `${DOW[piorSobra.dow]} é o dia com mais sobra: ${r1(piorSobra.hAtend)} h de atendimento para ${r1(piorSobra.hNecAtend)} h necessárias (venda média ${brl0(piorSobra.venda)}).`,
    );
  const faltaDow = [...dows].sort((x, y) => y.hNecAtend - y.hAtend - (x.hNecAtend - x.hAtend))[0];
  if (faltaDow && faltaDow.hNecAtend - faltaDow.hAtend > 2)
    a.push(`${DOW[faltaDow.dow]} pede mais gente: ${r1(faltaDow.hNecAtend)} h necessárias contra ${r1(faltaDow.hAtend)} h no ponto.`);

  // Horas vazias: slot com gente e sem venda dentro do dia (fora abertura/fechamento).
  for (const d of dows) {
    const vazias = d.slots.filter((s) => s.atend >= 2 && s.venda < 1 && s.necAtend === 0);
    const h = vazias.reduce((x, s) => x + s.atend, 0);
    if (h >= 4)
      a.push(
        `${DOW[d.dow]}: ${r1(h)} h de atendimento por dia em horário sem venda (${vazias.map((s) => `${String(horaDoSlot(s.slot)).padStart(2, '0')}h`).join(', ')}).`,
      );
  }

  // Cozinha.
  a.push(
    `Cozinha: ${Math.round(r.h.cozinha)} h no período — ${Math.round(r.hCozServico)} h no serviço (${r1(r.itensPorHCoz)} pratos por hora-cozinheiro) e ${Math.round(r.hCozProducao)} h fora do serviço, que contam como produção/pré-preparo e não como sobra.`,
  );
  const ant = e.anteriores.find((x) => x.dias >= 7);
  if (ant && ant.h.cozinha > 0 && ant.itensCoz > 0) {
    const dh = (r.h.cozinha / r.dias) / (ant.h.cozinha / ant.dias) - 1;
    const di = (r.itensCoz / r.dias) / (ant.itensCoz / ant.dias) - 1;
    if (dh > 0.1 && di < 0)
      a.push(
        `Pergunta pra cozinha: as horas por dia subiram ${Math.round(dh * 100)}% contra ${ant.mes} e os pratos por dia caíram ${Math.round(-di * 100)}%. Teve produção pra outra casa/evento? Se não, é excesso.`,
      );
    else if (dh < -0.1 && di > 0.1)
      a.push(`Cozinha com menos horas (${Math.round(dh * 100)}%) e mais pratos (+${Math.round(di * 100)}%) que em ${ant.mes}: conferir se não está sobrecarregada.`);
  }
  if (r.ordensProducao < 5)
    av.push(
      `A produção quase não é registrada (${r.ordensProducao} ordem(ns) de produção no período). Sem isso a hora da cozinha fora do serviço não tem como ser medida — registrar em /op ajuda o próximo estudo.`,
    );

  // Tendência do mês.
  if (ant) {
    const vd = r.venda / r.dias / (ant.venda / ant.dias || 1) - 1;
    const hd = r.hTotal / r.dias / (ant.hTotal / ant.dias || 1) - 1;
    a.push(
      `Contra ${ant.mes} (por dia): venda ${vd >= 0 ? '+' : ''}${Math.round(vd * 100)}%, horas da equipe ${hd >= 0 ? '+' : ''}${Math.round(hd * 100)}%.${vd < 0 && hd > 0 ? ' Venda caindo com mais horas — é o primeiro ponto pra conversa.' : ''}`,
    );
  }

  // Pessoas.
  const conta = (t: TipoSinal) => e.pessoas.filter((p) => p.sinais.some((s) => s.tipo === t));
  const vc = conta('virar_clt');
  if (vc.length)
    a.push(`${vc.length} intermitente(s) já trabalham como fixo, acima do empate de custo: ${vc.map((p) => p.nome.split(' ')[0]).join(', ')}. Pra eles, CLT (5x2 ou 6x1) tende a sair mais barato.`);
  const fs = conta('fim_de_semana');
  if (fs.length) a.push(`${fs.length} CLT trabalham quase só sex–dom: ${fs.map((p) => p.nome.split(' ')[0]).join(', ')}. Perfil de intermitente ou diarista de fim de semana.`);
  const dz = conta('doze_36');
  if (dz.length) a.push(`Desenho de 12x36 já aparece em: ${dz.map((p) => p.nome.split(' ')[0]).join(', ')} (12x36 é permitido pela CCT; no salão do Bar não cabe).`);
  const se = conta('sobra_escala');
  if (se.length) a.push(`CLT com bem menos horas que a escala: ${se.map((p) => p.nome.split(' ')[0]).join(', ')} — falta, atestado ou escala curta? Hora paga sem uso.`);
  const he = conta('hora_extra');
  if (he.length) a.push(`CLT acima da escala (hora extra): ${he.map((p) => p.nome.split(' ')[0]).join(', ')}.`);
  const dt = conta('diarista_2dias');
  if (dt.length) a.push(`Vêm até 2 dias por semana (cabe diarista): ${dt.map((p) => p.nome.split(' ')[0]).join(', ')}.`);
  const sv = conta('sem_valor');
  if (sv.length) av.push(`${sv.length} pessoa(s) sem regime/valor no cadastro — custo estimado a R$ ${CUSTO_HORA_ESTIMADO}/h: ${sv.map((p) => p.nome.split(' ')[0]).join(', ')}.`);
  const atip = e.dias.filter((d) => d.atipico);
  if (atip.length)
    av.push(`Fora da média (feriado/evento): ${atip.map((d) => `${d.dia.slice(8)}/${d.dia.slice(5, 7)}${d.feriado ? ` ${d.feriado}` : ''}`).join(', ')}.`);
  if (r.parcial) av.push(`Período parcial: ${r.ini.slice(8)}/${r.ini.slice(5, 7)} a ${r.fim.slice(8)}/${r.fim.slice(5, 7)} (${r.dias} dias). Valores "por mês" são projeção de 30 dias.`);
  av.push('Venda pelos itens lançados (sem os 10%). Horas pelo ponto próprio, na casa onde a pessoa bateu. Custo CLT = salário × encargos (FGTS + provisões) proporcional às horas na casa.');
  return { achados: a, avisos: av };
}

export async function montarEstudoEquipe(filialId: string, mes: string, hoje: string, opts: OpcoesEstudo = {}): Promise<EstudoEquipe | null> {
  const per = periodoDoMes(filialId, mes, hoje);
  if (!per) return null;
  const meses = [mesAnterior(mes, 1), mesAnterior(mes, 2)];
  const pers = meses.map((m) => ({ m, p: periodoDoMes(filialId, m, hoje) }));
  const [base, ...basesAnt] = await Promise.all([
    carregarBase(filialId, per.ini, per.fim, per.parcial),
    ...pers.filter((x) => x.p).map((x) => carregarBase(filialId, x.p!.ini, x.p!.fim, x.p!.parcial)),
  ]);
  const mesesAnt = pers.filter((x) => x.p).map((x) => x.m);

  const atip = marcarAtipicos(base);
  const prod = produtividades(base, atip);
  const atendP50 = pct(prod.atend, 0.5), atendP75 = pct(prod.atend, 0.75), atendP90 = pct(prod.atend, 0.9);
  const cozP50 = pct(prod.coz, 0.5), cozP75 = pct(prod.coz, 0.75), cozP90 = pct(prod.coz, 0.9);
  const metaAtend = opts.metaAtend && opts.metaAtend > 0 ? opts.metaAtend : Math.round(atendP75);
  const metaCoz = opts.metaCoz && opts.metaCoz > 0 ? opts.metaCoz : r1(cozP75);
  const minAtend = opts.minAtend && opts.minAtend > 0 ? opts.minAtend : 2;
  const padrao = !(opts.metaAtend && opts.metaAtend > 0) && !(opts.metaCoz && opts.metaCoz > 0);

  const calc = calcularDias(base, atip, metaAtend, metaCoz, minAtend);
  const pessoas = await calcularPessoas(base, filialId);
  const resumo = resumir(mes, base, calc.dias, pessoas);
  const anteriores = basesAnt.map((b, i) => {
    const at = marcarAtipicos(b);
    const c = calcularDias(b, at, metaAtend, metaCoz, minAtend);
    return resumir(mesesAnt[i], b, c.dias, null);
  });
  const parcialEstudo = {
    filialId,
    mes,
    resumo,
    anteriores,
    metas: { atend: metaAtend, coz: metaCoz, minAtend, atendP50, atendP75, atendP90, cozP50, cozP75, cozP90, padrao },
    dows: montarDows(base, calc),
    dias: calc.dias,
    pessoas,
  };
  const custoReal = await montarCustoReal(filialId, mes, resumo, pessoas).catch((err) => {
    console.error('[estudo-equipe] custo real', err);
    return undefined;
  });
  return { ...parcialEstudo, ...achadosDe(parcialEstudo), custoReal };
}

async function montarCustoReal(filialId: string, mes: string, resumo: ResumoMes, pessoas: PessoaEstudo[]): Promise<CustoRealResumo> {
  const c = await custoRealDaCasa(filialId, mes, resumo.ini, resumo.fim, pessoas.map((p) => ({ id: p.id, hCasa: p.hCasa, hTotal: p.hTotal })));
  const grupo = (): GrupoCustoReal => ({ pessoas: 0, horas: 0, pago: { ...PAGO_ZERO } });
  const registrados = grupo(), naoRegistrados = grupo();
  const pontoSemPagamento: CustoRealResumo['pontoSemPagamento'] = [];
  const tipos = Object.keys(PAGO_ZERO) as (keyof Pago)[];
  for (const p of pessoas) {
    p.registrado = c.registrado.get(p.id) ?? false;
    p.pago = c.porPessoa.get(p.id) ?? null;
    const g = p.registrado ? registrados : naoRegistrados;
    g.pessoas++;
    g.horas += p.hCasa;
    if (p.pago) for (const t of tipos) g.pago[t] += p.pago[t];
    else if (p.hCasa >= 4) pontoSemPagamento.push({ nome: p.nome, horas: Math.round(p.hCasa), registrado: p.registrado });
  }
  const custo = custoCasa(registrados.pago) + custoCasa(naoRegistrados.pago) + c.semPonto.reduce((x, s) => x + custoCasa(s.pago), 0);
  const dezPct = registrados.pago.dezPct + naoRegistrados.pago.dezPct + c.semPonto.reduce((x, s) => x + s.pago.dezPct, 0);
  pontoSemPagamento.sort((a, b) => b.horas - a.horas);
  return { registrados, naoRegistrados, semPonto: c.semPonto, pontoSemPagamento, custo, custoPctVenda: resumo.venda > 0 ? custo / resumo.venda : 0, dezPct };
}

const arred = (p: Pago) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.round(v as number)]));

/** Versão enxuta pra mandar à IA (sem hora a hora de cada dia). */
export function resumoParaIa(e: EstudoEquipe) {
  const n = (x: number) => Math.round(x * 10) / 10;
  return {
    mes: e.mes,
    periodo: `${e.resumo.ini} a ${e.resumo.fim} (${e.resumo.dias} dias${e.resumo.parcial ? ', parcial' : ''})`,
    resumo: {
      venda: Math.round(e.resumo.venda),
      pratosCozinha: Math.round(e.resumo.itensCoz),
      pedidos: e.resumo.pedidos,
      horasPorGrupo: Object.fromEntries(GRUPOS.map((g) => [NOME_GRUPO[g], Math.round(e.resumo.h[g])])),
      horasAtendimento: Math.round(e.resumo.hAtend),
      horasNecessariasAtendimento: Math.round(e.resumo.hNecAtend),
      sobraAtendimento: Math.round(e.resumo.sobraAtend),
      faltaAtendimento: Math.round(e.resumo.faltaAtend),
      cozinhaServicoH: Math.round(e.resumo.hCozServico),
      cozinhaProducaoH: Math.round(e.resumo.hCozProducao),
      vendaPorHoraAtendimento: Math.round(e.resumo.vendaPorHAtend),
      pratosPorHoraCozinha: n(e.resumo.itensPorHCoz),
      custoEquipeEstimado: Math.round(e.resumo.custo),
      custoPctVenda: Math.round(e.resumo.custoPctVenda * 1000) / 10,
      ...(e.custoReal
        ? {
            custoRealLancado: {
              obs: 'O que a casa lançou de verdade no período. Os 10% são pagos pelo cliente e ficam fora do custo. Encargos = estimativa sobre o salário.',
              custoCasa: Math.round(e.custoReal.custo),
              custoPctVenda: Math.round(e.custoReal.custoPctVenda * 1000) / 10,
              dezPorCentoRepassado: Math.round(e.custoReal.dezPct),
              registrados: { pessoas: e.custoReal.registrados.pessoas, horas: Math.round(e.custoReal.registrados.horas), ...arred(e.custoReal.registrados.pago) },
              naoRegistrados: { pessoas: e.custoReal.naoRegistrados.pessoas, horas: Math.round(e.custoReal.naoRegistrados.horas), ...arred(e.custoReal.naoRegistrados.pago) },
              pagosSemPontoNaCasa: e.custoReal.semPonto.slice(0, 25).map((s) => ({ nome: s.nome, registrado: s.registrado, ...arred(s.pago) })),
              pontoSemPagamento: e.custoReal.pontoSemPagamento.slice(0, 25),
            },
          }
        : {}),
      pessoasDistintas: e.resumo.pessoas,
      ordensDeProducaoRegistradas: e.resumo.ordensProducao,
    },
    mesesAnteriores: e.anteriores.map((a) => ({
      mes: a.mes,
      dias: a.dias,
      vendaDia: Math.round(a.venda / (a.dias || 1)),
      horasDia: n(a.hTotal / (a.dias || 1)),
      horasCozinhaDia: n(a.h.cozinha / (a.dias || 1)),
      pratosDia: n(a.itensCoz / (a.dias || 1)),
      vendaPorHoraAtendimento: Math.round(a.vendaPorHAtend),
    })),
    metas: {
      atendimentoRsPorHora: e.metas.atend,
      cozinhaPratosPorHora: e.metas.coz,
      minimoAtendimento: e.metas.minAtend,
      produtividadeAtendimentoP50P75P90: [Math.round(e.metas.atendP50), Math.round(e.metas.atendP75), Math.round(e.metas.atendP90)],
    },
    porDiaDaSemana: e.dows.map((d) => ({
      dia: DOW[d.dow],
      diasTipicos: d.dias,
      vendaMedia: Math.round(d.venda),
      pratos: Math.round(d.itensCoz),
      hAtend: n(d.hAtend),
      hNecAtend: n(d.hNecAtend),
      hCozServico: n(d.hCozServico),
      hCozProducao: n(d.hCozProducao),
      hLimpeza: n(d.hLimpeza),
      horaAHora: d.slots
        .filter((s) => s.atend > 0.2 || s.venda > 0 || s.cozinha > 0.2)
        .map((s) => `${String(horaDoSlot(s.slot)).padStart(2, '0')}h: venda ${Math.round(s.venda)}, atend ${n(s.atend)} (precisa ${n(s.necAtend)}), coz ${n(s.cozinha)}, pratos ${n(s.itensCoz)}`),
    })),
    diasFora: e.dias.filter((d) => d.atipico).map((d) => ({ dia: d.dia, feriado: d.feriado, venda: Math.round(d.venda) })),
    pessoas: e.pessoas.map((p) => ({
      nome: p.nome,
      cargo: p.cargo,
      grupo: NOME_GRUPO[p.grupo],
      regime: p.regime,
      valor: p.valor,
      daCasa: p.daCasa,
      horasNaCasa: p.hCasa,
      horasTodasCasas: p.hTotal,
      dias: p.dias,
      hDia: p.hDia,
      diasSemana: p.diasSemana,
      pctSexDom: Math.round(p.pctFds * 100),
      diasDe10hOuMais: p.diasLongos,
      horasMes30: p.horasMes30,
      empateComFixoH: p.empateH,
      custo: p.custo,
      registrado: p.registrado,
      pagoDeVerdade: p.pago ? arred(p.pago) : null,
      diasPorDiaDaSemana: Object.fromEntries(DOW.map((d, i) => [d, p.porDow[i]])),
      horarioTipico: p.horarioTipico,
      sinais: p.sinais.map((s) => s.texto),
    })),
    achadosDoCalculo: e.achados,
    avisos: e.avisos,
  };
}
