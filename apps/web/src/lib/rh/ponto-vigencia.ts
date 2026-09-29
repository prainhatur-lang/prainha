// Virada do ponto: antes da data a fonte das horas da folha é o espelho da
// Stelanto (upload XLSX); da data em diante é o ponto facial próprio. Data
// por casa. Na semana que cruza a virada cada fonte preenche só o seu lado —
// nunca as duas no mesmo dia.
const PONTO_PROPRIO_DESDE_PADRAO = '2026-10-01';
const PONTO_PROPRIO_DESDE_POR_FILIAL: Record<string, string> = {
  // 03 Prainha Mar começou antes das outras.
  'e899dae2-38bf-4f3f-9149-7effd059fab8': '2026-09-30',
};

/** Primeiro dia (YYYY-MM-DD) em que a filial usa o ponto próprio na folha. */
export function pontoProprioDesde(filialId: string): string {
  return PONTO_PROPRIO_DESDE_POR_FILIAL[filialId] ?? PONTO_PROPRIO_DESDE_PADRAO;
}

/** true se o dia (YYYY-MM-DD) da filial já é do ponto próprio. */
export function diaDoPontoProprio(filialId: string, dia: string): boolean {
  return dia >= pontoProprioDesde(filialId);
}
