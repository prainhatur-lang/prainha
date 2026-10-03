// Dia operacional do ponto — espelho, na nuvem, da regra do relógio da loja
// (vendas-local/server.mjs: PONTO_VIRADA_HORA e diaOperacionalDe).
//
// O dia D do ponto vai das 05:00 de D às 04:59 de D+1, no horário da loja (BRT,
// sem horário de verão): quem entra à noite e sai depois da meia-noite fecha o
// turno no dia em que ENTROU. Então, na correção manual do /rh/ponto, hora
// digitada antes das 05:00 na coluna do dia D é a madrugada de D+1. Gravada no
// próprio D ela ficava 24 h adiantada, na frente das entradas do dia: a saída
// virava a primeira batida e o reajuste da sequência a trocava por entrada
// (Alvaro, Tabuará: saída 00:02 do turno de 01/10/2026, lançada em 03/10).
//
// Módulo puro (sem banco e sem o fuso da máquina): serve pra tela e pra rota.

import { dateToBrYmd } from '@/lib/datas';

/** Hora (BRT) em que o dia do ponto vira. Tem que ser a mesma da loja. */
export const PONTO_VIRADA_HORA = 5;

const DIA_MS = 24 * 60 * 60 * 1000;

/** 'HH:MM' digitado cai antes da virada (00:00–04:59)? */
export function horaDeMadrugada(hora: string): boolean {
  return /^\d{2}:\d{2}/.test(hora) && Number(hora.slice(0, 2)) < PONTO_VIRADA_HORA;
}

/** 'YYYY-MM-DD' somado de n dias (conta de calendário, sem fuso). */
export function somarDias(ymd: string, n: number): string {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 'DD/MM'. */
export function diaMes(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

/** Dia de CALENDÁRIO da hora digitada na coluna do dia operacional `dia`:
 *  antes da virada é o dia seguinte; das 05:00 em diante, o próprio dia. */
export function dataDaHora(dia: string, hora: string): string {
  return horaDeMadrugada(hora) ? somarDias(dia, 1) : dia;
}

/** 'HH:MM' de um instante no relógio da loja (BRT). */
export function horaMinutoBr(quando: Date): string {
  return new Date(quando.getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
}

/** O instante é a madrugada que fecha o dia operacional `dia` (00:00–04:59 de D+1)? */
export function madrugadaDoDia(dia: string, quando: Date): boolean {
  if (Number.isNaN(quando.getTime())) return false;
  return horaDeMadrugada(horaMinutoBr(quando)) && dateToBrYmd(quando) === somarDias(dia, 1);
}

/** Rede do servidor pra aba aberta com a tela antiga, que manda a hora da
 *  madrugada no próprio dia da coluna: instante antes da virada de `dia` vai
 *  pro dia seguinte. O que já chega certo (tela nova) passa igual. */
export function quandoNoDiaOperacional(dia: string, quando: Date): Date {
  if (Number.isNaN(quando.getTime())) return quando;
  const adiantado = horaDeMadrugada(horaMinutoBr(quando)) && dateToBrYmd(quando) === dia;
  return adiantado ? new Date(quando.getTime() + DIA_MS) : quando;
}

/** Recusa da madrugada que ainda não chegou (00:30 digitado na coluna de hoje,
 *  de dia): viraria batida no futuro, e o relógio da loja recusa a pessoa até
 *  lá — o intervalo de 5 min entre batidas conta da última, mesmo que seja
 *  amanhã. Quase sempre é a madrugada que já passou, lançada na coluna errada. */
export function msgMadrugadaFutura(dia: string, hora: string): string {
  return `${hora} de ${diaMes(somarDias(dia, 1))} ainda não chegou. Batida depois da meia-noite se lança na coluna do dia em que a pessoa entrou.`;
}
