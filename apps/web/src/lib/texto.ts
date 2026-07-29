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
