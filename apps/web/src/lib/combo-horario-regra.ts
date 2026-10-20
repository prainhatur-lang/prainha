// Regra de horário do combo — funções PURAS (sem banco), usadas no servidor
// (cron, gravação) e na tela (calendário, "agora: à venda"). O resto mora em
// lib/combo-horario.ts.

export type RegraCombo = {
  ativa: boolean;
  /** 0=dom … 6=sáb. Vazio = todos os dias. */
  dias: number[];
  /** 'HH:MM' ou null (o dia todo). Fim menor que início = vira a meia-noite. */
  horaInicio: string | null;
  horaFim: string | null;
  /** 'YYYY-MM-DD' ou null. */
  dataInicio: string | null;
  dataFim: string | null;
  /** Dias em que NÃO vale (feriado, evento). */
  datasFora: string[];
  /** Dias em que vale mesmo fora dos dias da semana / da vigência. */
  datasExtra: string[];
};

export type RegraComboSalva = RegraCombo & {
  estadoAplicado: 'dentro' | 'fora' | null;
  aplicadoEm: string | null;
  atualizadoPor: string | null;
};

export const DIAS_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Agora em BRT: dia, dia da semana e hora (HH:MM). */
export function agoraBr(ms = Date.now()) {
  const d = new Date(ms - 3 * 3600 * 1000);
  return { ymd: d.toISOString().slice(0, 10), dow: d.getUTCDay(), hhmm: d.toISOString().slice(11, 16) };
}

function dowDe(ymd: string): number {
  return new Date(ymd + 'T12:00:00Z').getUTCDay();
}

function diaAnterior(ymd: string): string {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** O DIA vale? (sem olhar a hora) */
export function diaVale(r: RegraCombo, ymd: string): boolean {
  if (r.datasFora.includes(ymd)) return false;
  if (r.datasExtra.includes(ymd)) return true;
  if (r.dataInicio && ymd < r.dataInicio) return false;
  if (r.dataFim && ymd > r.dataFim) return false;
  return r.dias.length === 0 || r.dias.includes(dowDe(ymd));
}

/** Vale neste instante? Faixa que vira a meia-noite (18:00–02:00): a
 *  madrugada pertence ao dia anterior — 01:00 de sábado é a sexta. */
export function valeAgora(r: RegraCombo, ms = Date.now()): boolean {
  if (!r.ativa) return true;
  const { ymd, hhmm } = agoraBr(ms);
  const ini = r.horaInicio;
  const fim = r.horaFim;
  if (!ini && !fim) return diaVale(r, ymd);
  const a = ini ?? '00:00';
  const b = fim ?? '24:00';
  if (a <= b) return diaVale(r, ymd) && hhmm >= a && hhmm < b;
  // vira a meia-noite
  if (hhmm >= a) return diaVale(r, ymd);
  if (hhmm < b) return diaVale(r, diaAnterior(ymd));
  return false;
}

/** "seg a sex · 11:00–15:00 · até 31/12" */
export function resumoRegra(r: RegraCombo): string {
  if (!r.ativa) return 'sem horário (vale sempre)';
  const partes: string[] = [];
  const dias = [...r.dias].sort((x, y) => x - y);
  if (dias.length === 0 || dias.length === 7) partes.push('todos os dias');
  else {
    const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
    partes.push(seguidos && dias.length > 2
      ? `${DIAS_CURTO[dias[0]]} a ${DIAS_CURTO[dias[dias.length - 1]]}`
      : dias.map((d) => DIAS_CURTO[d]).join(', '));
  }
  if (r.horaInicio || r.horaFim) partes.push(`${r.horaInicio ?? '00:00'}–${r.horaFim ?? '24:00'}`);
  const br = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
  if (r.dataInicio && r.dataFim) partes.push(`${br(r.dataInicio)} a ${br(r.dataFim)}`);
  else if (r.dataInicio) partes.push(`a partir de ${br(r.dataInicio)}`);
  else if (r.dataFim) partes.push(`até ${br(r.dataFim)}`);
  if (r.datasFora.length) partes.push(`${r.datasFora.length} dia(s) fora`);
  if (r.datasExtra.length) partes.push(`${r.datasExtra.length} dia(s) extra`);
  return partes.join(' · ');
}
