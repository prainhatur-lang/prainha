// Normalização de texto pra busca: minúsculas e sem acentos ("Açaí" ~ "acai").
// Usar nos filtros de tela (produtos, clientes, fornecedores…) dos DOIS lados:
// normalizaBusca(campo).includes(normalizaBusca(digitado)).

import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

export function normalizaBusca(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

/** Quebra o texto digitado em palavras pra busca "todas as palavras, em
 *  qualquer ordem". Ignora conectivos curtos ("de", "c/"). */
export function palavrasBusca(q: string): string[] {
  const ws = q.split(/[\s\-\/,]+/).map((w) => w.trim()).filter((w) => w.length >= 2);
  const semConectivo = ws.filter((w) => !['de', 'da', 'do', 'com', 'sem'].includes(normalizaBusca(w)));
  return semConectivo.length ? semConectivo : ws.length ? ws : q.trim() ? [q.trim()] : [];
}

/**
 * Versão SQL do mesmo comportamento: "coluna contém termo", ignorando caixa e
 * acentos. Ex.: buscaIlike(schema.produto.nome, 'acai') acha "Açaí Premium".
 *
 * No Supabase a extensão mora no schema `extensions` (ver
 * scripts/migrate-unaccent.mjs). unaccent() não é IMMUTABLE, então não usa
 * índice — sem perda aqui, porque o padrão já era `%termo%`.
 */
export function buscaIlike(coluna: AnyColumn, termo: string): SQL {
  return sql`extensions.unaccent(${coluna}) ILIKE extensions.unaccent(${'%' + termo + '%'})`;
}

/** Mesma coisa, quando a coluna já vem como fragmento SQL cru. */
export function buscaIlikeSql(expr: SQL, termo: string): SQL {
  return sql`extensions.unaccent(${expr}) ILIKE extensions.unaccent(${'%' + termo + '%'})`;
}
