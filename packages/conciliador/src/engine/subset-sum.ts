/**
 * Encontra um subconjunto dos `items` cuja soma se aproxime de `target` dentro
 * da tolerancia. Trabalha em centavos para evitar erros de ponto flutuante.
 *
 * Retorna os indices selecionados, ou null se nao achar.
 *
 * Para conjuntos grandes (>25), faz fallback heuristico (1 ou 2 elementos).
 */
export function subsetSum(items: number[], target: number, tolerance = 0.05): number[] | null {
  const T = Math.round(target * 100);
  const A = items.map((v) => Math.round(v * 100));
  const tol = Math.round(tolerance * 100);

  if (A.length > 25) {
    for (let i = 0; i < A.length; i++) if (Math.abs(A[i]! - T) <= tol) return [i];
    for (let i = 0; i < A.length; i++) {
      for (let j = i + 1; j < A.length; j++) {
        if (Math.abs(A[i]! + A[j]! - T) <= tol) return [i, j];
      }
    }
    return null;
  }

  const result: number[] = [];
  function bt(idx: number, sum: number): boolean {
    if (Math.abs(sum - T) <= tol) return true;
    if (idx >= A.length || sum > T + tol) return false;
    result.push(idx);
    if (bt(idx + 1, sum + A[idx]!)) return true;
    result.pop();
    return bt(idx + 1, sum);
  }
  return bt(0, 0) ? [...result] : null;
}
