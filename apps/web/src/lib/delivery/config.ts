// Config e agenda do delivery: resolver loja pelo slug, saber se está aberta
// agora e gerar os horários agendáveis (calendário por dia e hora).
//
// Tudo em BRT via helpers de @/lib/datas — NUNCA new Date().toISOString().

import { db, schema } from '@concilia/db';
import { sql } from 'drizzle-orm';
import type { DeliveryConfig, DeliveryJanela } from '@concilia/db/schema';
import { hojeBr, horaAgoraBr, dateToBrYmd } from '@/lib/datas';

export const DELIVERY_DEFAULTS = {
  slotMinutos: 30,
  antecedenciaMinutos: 45,
  diasFuturos: 7,
} as const;

export interface LojaDelivery {
  filialId: string;
  nome: string;
  config: DeliveryConfig;
}

/** Coage "true"/"false" (texto) pro booleano certo, preservando undefined —
 *  vários campos têm default ligado via `!== false`, então undefined importa.
 *  Existe porque o jsonb pode receber string de fora do app (script, migration,
 *  edição manual): aí `if (config.pausado)` via "false" como pausado enquanto
 *  `config.pausado === true` via como aberto, e a loja ficava aberta na tela
 *  recusando todo pedido. Normalizar na carga deixa todo leitor de acordo. */
function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v == null) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return Boolean(v);
}

const CHAVES_BOOL = [
  'ativo',
  'pausado',
  'retiradaAtiva',
  'entregaAtiva',
  'gratisPrimeiraCompra',
  'pixAtivo',
  'cartaoAtivo',
  'naEntregaAtivo',
] as const;

function normalizarConfig(c: DeliveryConfig): DeliveryConfig {
  const out = { ...c } as Record<string, unknown>;
  for (const k of CHAVES_BOOL) {
    const v = bool(out[k]);
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as DeliveryConfig;
}

/** Filiais com delivery ativo (pra página /delivery listar as lojas). */
export async function lojasDeliveryAtivas(): Promise<LojaDelivery[]> {
  const rows = await db
    .select({
      filialId: schema.filial.id,
      nome: schema.filial.nome,
      config: schema.filial.deliveryConfig,
    })
    .from(schema.filial)
    .where(sql`(${schema.filial.deliveryConfig}->>'ativo')::boolean IS TRUE`);
  return rows
    .filter((r) => r.config?.slug)
    .map((r) => ({ filialId: r.filialId, nome: r.nome, config: normalizarConfig(r.config!) }));
}

/** Resolve a loja pelo slug público. Null se não existe ou delivery desligado. */
export async function lojaDeliveryPorSlug(slug: string): Promise<LojaDelivery | null> {
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) return null;
  const rows = await db
    .select({
      filialId: schema.filial.id,
      nome: schema.filial.nome,
      config: schema.filial.deliveryConfig,
    })
    .from(schema.filial)
    .where(sql`${schema.filial.deliveryConfig}->>'slug' = ${slug}`)
    .limit(1);
  const r = rows[0];
  if (!r?.config) return null;
  const config = normalizarConfig(r.config);
  if (config.ativo !== true) return null;
  return { filialId: r.filialId, nome: r.nome, config };
}

/** Dia da semana (0=domingo..6=sábado) de um YYYY-MM-DD, sem fuso. */
export function diaSemanaDeYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function hmParaMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function minParaHm(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function janelasDoDia(config: DeliveryConfig, ymd: string): DeliveryJanela[] {
  if (config.diasFechados?.includes(ymd)) return [];
  const dow = diaSemanaDeYmd(ymd);
  const janelas = config.horarios?.[dow] ?? [];
  return janelas.filter((j) => j.abre && j.fecha && hmParaMin(j.fecha) > hmParaMin(j.abre));
}

/** Loja aberta AGORA (alguma janela de hoje contém a hora atual, sem pausa). */
export function abertaAgora(config: DeliveryConfig): boolean {
  if (config.pausado) return false;
  const agora = hmParaMin(horaAgoraBr());
  return janelasDoDia(config, hojeBr()).some(
    (j) => agora >= hmParaMin(j.abre) && agora < hmParaMin(j.fecha),
  );
}

/** Horários agendáveis de um dia (HH:MM). Pra hoje, corta pela antecedência. */
export function slotsDoDia(config: DeliveryConfig, ymd: string): string[] {
  const passo = config.slotMinutos ?? DELIVERY_DEFAULTS.slotMinutos;
  const antecedencia = config.antecedenciaMinutos ?? DELIVERY_DEFAULTS.antecedenciaMinutos;
  const ehHoje = ymd === hojeBr();
  const minMinimo = ehHoje ? hmParaMin(horaAgoraBr()) + antecedencia : -1;

  const slots: string[] = [];
  for (const j of janelasDoDia(config, ymd)) {
    const fim = hmParaMin(j.fecha);
    for (let t = hmParaMin(j.abre); t < fim; t += passo) {
      if (t >= minMinimo) slots.push(minParaHm(t));
    }
  }
  return [...new Set(slots)].sort();
}

export interface DiaAgenda {
  /** YYYY-MM-DD */
  data: string;
  /** 0=domingo..6=sábado */
  diaSemana: number;
  slots: string[];
}

/** Agenda completa: hoje + diasFuturos-1 dias, cada um com seus horários. */
export function agendaDelivery(config: DeliveryConfig): {
  dias: DiaAgenda[];
  asapDisponivel: boolean;
} {
  const total = Math.min(Math.max(config.diasFuturos ?? DELIVERY_DEFAULTS.diasFuturos, 1), 30);
  const dias: DiaAgenda[] = [];
  const hoje = hojeBr();
  for (let i = 0; i < total; i++) {
    // hoje + i dias, em BRT (soma no instante e converte de volta)
    const base = new Date(`${hoje}T12:00:00-03:00`);
    base.setDate(base.getDate() + i);
    const ymd = dateToBrYmd(base);
    dias.push({ data: ymd, diaSemana: diaSemanaDeYmd(ymd), slots: slotsDoDia(config, ymd) });
  }
  return { dias, asapDisponivel: abertaAgora(config) };
}

/** Valida um agendamento vindo do checkout (regenera a agenda do servidor). */
export function agendamentoValido(
  config: DeliveryConfig,
  agendamento: { asap?: boolean; data?: string; hora?: string },
): { ok: boolean; data: string; hora: string | null; erro?: string } {
  if (config.pausado) {
    return { ok: false, data: '', hora: null, erro: 'A loja está pausada no momento.' };
  }
  if (agendamento.asap) {
    if (!abertaAgora(config)) {
      return {
        ok: false,
        data: '',
        hora: null,
        erro: 'A loja está fechada agora — escolha um horário agendado.',
      };
    }
    return { ok: true, data: hojeBr(), hora: null };
  }
  const data = agendamento.data ?? '';
  const hora = agendamento.hora ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) {
    return { ok: false, data: '', hora: null, erro: 'Escolha dia e horário.' };
  }
  if (!slotsDoDia(config, data).includes(hora)) {
    return {
      ok: false,
      data: '',
      hora: null,
      erro: 'Esse horário não está mais disponível — escolha outro.',
    };
  }
  return { ok: true, data, hora };
}

export const DIAS_SEMANA_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
