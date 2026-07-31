// Calcula top-N sugestoes de produto interno pra um item de NF orfao
// (sem produto_id). Usa o mesmo algoritmo do match em massa (jaccard de
// tokens 3+ chars), mas retorna as N melhores em vez de aplicar threshold.

export function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(s: string | null | undefined): Set<string> {
  return new Set(
    normalize(s)
      .split(' ')
      .filter((t) => t.length >= 3),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface Sugestao {
  produtoId: string;
  nome: string;
  categoria: string | null;
  unidade: string;
  score: number;
}

export function topSugestoes(
  descricao: string | null,
  produtos: Array<{ id: string; nome: string | null; categoria: string | null; unidade: string }>,
  n = 3,
): Sugestao[] {
  const tDesc = tokens(descricao);
  if (tDesc.size === 0) return [];
  return produtos
    .map((p) => ({
      produtoId: p.id,
      nome: p.nome ?? '(sem nome)',
      categoria: p.categoria,
      unidade: p.unidade,
      score: jaccard(tDesc, tokens(p.nome)),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
