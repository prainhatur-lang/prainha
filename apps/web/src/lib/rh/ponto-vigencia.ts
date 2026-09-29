// Virada do ponto: até 30/09/2026 a fonte das horas da folha é o espelho da
// Stelanto (upload XLSX); a partir de 01/10/2026 é o ponto facial próprio.
// Vale pras 3 casas. Na semana que cruza a data (28/09–04/10) cada fonte
// preenche só o seu lado — nunca as duas no mesmo dia.
export const PONTO_PROPRIO_DESDE = '2026-10-01';

/** true se o dia (YYYY-MM-DD) já é do ponto próprio. */
export function diaDoPontoProprio(dia: string): boolean {
  return dia >= PONTO_PROPRIO_DESDE;
}
