/**
 * Encontra um subconjunto dos `items` cuja soma se aproxime de `target`.
 * Retorna os indices selecionados, ou null.
 */
export function subsetSum(items: number[], target: number, tolerance = 0.05): number[] | null {
  const res = subsetSumMulti(items, target, tolerance, 1);
  return res.length ? res[0]! : null;
}

/**
 * Versao que retorna ATE `max` subsets distintos que somam o target.
 * Util pra tentativas de re-alocacao onde o primeiro subset encontrado
 * nao permite realocar outros grupos — tenta proximo subset candidato.
 */
export function subsetSumMulti(
  items: number[],
  target: number,
  tolerance = 0.05,
  max = 5,
): number[][] {
  const T = Math.round(target * 100);
  const A = items.map((v) => Math.round(v * 100));
  const tol = Math.round(tolerance * 100);
  const resultados: number[][] = [];

  if (A.length === 0 || T <= 0) return resultados;

  // Fast path: 1 elemento
  for (let i = 0; i < A.length && resultados.length < max; i++) {
    if (Math.abs(A[i]! - T) <= tol) resultados.push([i]);
  }
  if (resultados.length >= max) return resultados;

  // Fast path: 2 elementos
  for (let i = 0; i < A.length && resultados.length < max; i++) {
    for (let j = i + 1; j < A.length && resultados.length < max; j++) {
      if (Math.abs(A[i]! + A[j]! - T) <= tol) resultados.push([i, j]);
    }
  }
  if (resultados.length >= max) return resultados;

  // Backtracking ordenado — maiores primeiro pra fechar target rapido
  const indexed = A.map((v, i) => ({ v, origIdx: i })).sort((a, b) => b.v - a.v);
  const vals = indexed.map((x) => x.v);
  const n = vals.length;

  // Suffix sum pra pruning
  const suffixSum = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffixSum[i] = suffixSum[i + 1]! + vals[i]!;

  const MAX_ITER = 1_000_000;
  let iters = 0;
  const picked: number[] = [];

  function go(idx: number, sum: number): void {
    if (resultados.length >= max) return;
    iters++;
    if (iters > MAX_ITER) return;
    if (Math.abs(sum - T) <= tol && picked.length >= 3) {
      // Adiciona o subset atual nos resultados
      resultados.push(picked.map((i) => indexed[i]!.origIdx).sort((a, b) => a - b));
      return;
    }
    if (sum > T + tol) return;
    if (idx >= n) return;
    if (sum + suffixSum[idx]! < T - tol) return;

    // Tenta pegar
    picked.push(idx);
    go(idx + 1, sum + vals[idx]!);
    picked.pop();
    if (resultados.length >= max) return;
    // Tenta pular
    go(idx + 1, sum);
  }

  go(0, 0);
  return resultados;
}
