// Utilitarios de data em horario BRT (UTC-3).
//
// PROBLEMA: Vercel roda em UTC. Um pagamento feito em 11/01/2026 21:30 BRT
// tem timestamp UTC 12/01/2026 00:30Z. `toISOString().slice(0,10)` retornaria
// "2026-01-12" — cai no dia seguinte, quebra comparacoes e filtros por dia.
//
// SOLUCAO: sempre converter pra BRT antes de pegar o dia. Use essas funcoes
// em vez de `.toISOString().slice(0,10)` quando o Date for um timestamp UTC.
//
// Quando NAO usar:
// - Date ja construido com sufixo '-03:00' em string ISO: o UTC ja foi
//   calculado assumindo BRT, entao `.toISOString().slice(0,10)` esta ok.
// - Date construido com Date.UTC(...) pra calcular limites de mes: esta ok.
//
// Quando usar:
// - Campo Date vindo do banco (pagamento.dataPagamento, lancamento.dataMovimento).
// - `new Date()` pra pegar "hoje".

/** Converte um Date (timestamp UTC) para YYYY-MM-DD em horario BRT (UTC-3). */
export function dateToBrYmd(d: Date): string {
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Data de hoje em BRT no formato YYYY-MM-DD. */
export function hojeBr(): string {
  return dateToBrYmd(new Date());
}

/** N dias atras em BRT no formato YYYY-MM-DD. */
export function diasAtrasBr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dateToBrYmd(d);
}

/** Constroi um Date cujo instante e' a 00:00:00 de um dia em BRT. */
export function brDateStart(ymd: string): Date {
  return new Date(ymd + 'T00:00:00-03:00');
}

/** Constroi um Date cujo instante e' a 23:59:59 de um dia em BRT. */
export function brDateEnd(ymd: string): Date {
  return new Date(ymd + 'T23:59:59-03:00');
}
