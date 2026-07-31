// Helpers pra trabalhar com semana operacional (segunda 00:00 a domingo 23:59).

/** Retorna [segunda, domingo] da semana que CONTÉM a data passada (timezone BRT).
 *  Sempre retorna como YYYY-MM-DD. */
export function semanaContemDia(dia: Date): { inicio: string; fim: string } {
  // dia.getDay(): 0=dom, 1=seg, 2=ter, ..., 6=sab
  const diaSemana = dia.getDay();
  const offsetParaSeg = diaSemana === 0 ? -6 : 1 - diaSemana;
  const inicio = new Date(dia);
  inicio.setDate(dia.getDate() + offsetParaSeg);
  const fim = new Date(inicio);
  fim.setDate(inicio.getDate() + 6);
  return { inicio: toIsoDate(inicio), fim: toIsoDate(fim) };
}

/** Semana anterior à data passada. Default = hoje (BRT). */
export function semanaAnterior(de: Date = new Date()): { inicio: string; fim: string } {
  const sete = new Date(de);
  sete.setDate(de.getDate() - 7);
  return semanaContemDia(sete);
}

/** Semana atual (que está rolando agora, ainda não fechou). */
export function semanaAtual(de: Date = new Date()): { inicio: string; fim: string } {
  return semanaContemDia(de);
}

/** YYYY-MM-DD em timezone local. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Lista os 7 dias (YYYY-MM-DD) de uma semana. */
export function diasDaSemana(inicio: string): string[] {
  const dias: string[] = [];
  const d = new Date(inicio + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    dias.push(toIsoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return dias;
}

/** Label amigável: '27/04/2026 a 03/05/2026'. */
export function labelSemana(inicio: string, fim: string): string {
  return `${formatBr(inicio)} a ${formatBr(fim)}`;
}

function formatBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Nome curto do dia da semana (seg, ter, qua...). */
export function nomeDia(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()];
}
