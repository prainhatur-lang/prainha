/**
 * Encontra um subconjunto dos `items` cuja soma se aproxime de `target` dentro
 * da tolerancia. Trabalha em centavos para evitar erros de ponto flutuante.
 *
 * Retorna os indices selecionados (em relacao ao array original), ou null.
 *
 * Abordagem:
 *  1. Tenta 1 elemento (O(n))
 *  2. Tenta 2 elementos (O(n²))
 *  3. Backtracking ordenado por valor decrescente, com pruning por suffix sum
 *     + limite de 1M iteracoes. Resolve quase todos os casos praticos de
 *     conciliacao bancaria (<100 itens, target <R$ 100k).
 */
export function subsetSum(items: number[], target: number, tolerance = 0.05): number[] | null {
  const T = Math.round(target * 100);
  const A = items.map((v) => Math.round(v * 100));
  const tol = Math.round(tolerance * 100);

  if (A.length === 0 || T <= 0) return null;

  // Fast path: 1 elemento
  for (let i = 0; i < A.length; i++) {
    if (Math.abs(A[i]! - T) <= tol) return [i];
  }

  // Fast path: 2 elementos
  for (let i = 0; i < A.length; i++) {
    for (let j = i + 1; j < A.length; j++) {
      if (Math.abs(A[i]! + A[j]! - T) <= tol) return [i, j];
    }
  }

  // Backtracking ordenado — maiores primeiro pra fechar target rapido
  const indexed = A.map((v, i) => ({ v, origIdx: i })).sort((a, b) => b.v - a.v);
  const vals = indexed.map((x) => x.v);
  const n = vals.length;

  // Suffix sum pra pruning: se soma atual + soma do resto < target, impossivel
  const suffixSum = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffixSum[i] = suffixSum[i + 1]! + vals[i]!;

  const MAX_ITER = 1_000_000;
  let iters = 0;
  const picked: number[] = [];

  function go(idx: number, sum: number): boolean {
    iters++;
    if (iters > MAX_ITER) return false;
    if (Math.abs(sum - T) <= tol) return true;
    if (sum > T + tol) return false;
    if (idx >= n) return false;
    // Prune: resto nao alcanca o target
    if (sum + suffixSum[idx]! < T - tol) return false;

    // Tenta pegar
    picked.push(idx);
    if (go(idx + 1, sum + vals[idx]!)) return true;
    picked.pop();
    // Tenta pular
    return go(idx + 1, sum);
  }

  if (go(0, 0)) {
    return picked.map((i) => indexed[i]!.origIdx).sort((a, b) => a - b);
  }
  return null;
}
