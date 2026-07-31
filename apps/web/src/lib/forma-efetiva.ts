// Helper pra resolver forma/bandeira efetiva de um pagamento.
//
// Quando user aceita divergencia OPERADORA com formas diferentes,
// pagamento.formaEfetiva e pagamento.bandeiraEfetiva sao populadas com
// os valores da Cielo (forma processada de fato).
//
// Uso: relatorios que agregam por forma de pagamento devem chamar essas
// funcoes em vez de ler formaPagamento direto, pra refletir as correcoes.
//
// Auditoria de taxas, dashboard analitico e engine Cielo↔Banco já leem
// direto da vendaAdquirente — nao precisam dessas helpers.

import { sql, type SQL } from 'drizzle-orm';
import { schema } from '@concilia/db';

/** Retorna formaEfetiva (se setada via aceite de divergencia) ou
 *  formaPagamento original (default = forma como o garçom registrou). */
export function formaEfetiva(p: {
  formaPagamento?: string | null;
  formaEfetiva?: string | null;
}): string | null {
  return p.formaEfetiva ?? p.formaPagamento ?? null;
}

/** Retorna bandeiraEfetiva (Cielo) ou bandeiraMfe original do PDV. */
export function bandeiraEfetiva(p: {
  bandeiraMfe?: string | null;
  bandeiraEfetiva?: string | null;
}): string | null {
  return p.bandeiraEfetiva ?? p.bandeiraMfe ?? null;
}

/** SQL helper pra usar dentro de selects: COALESCE(forma_efetiva, forma_pagamento). */
export function formaEfetivaSql(): SQL<string> {
  return sql<string>`COALESCE(${schema.pagamento.formaEfetiva}, ${schema.pagamento.formaPagamento})`;
}

/** SQL helper pra usar dentro de selects: COALESCE(bandeira_efetiva, bandeira_mfe). */
export function bandeiraEfetivaSql(): SQL<string> {
  return sql<string>`COALESCE(${schema.pagamento.bandeiraEfetiva}, ${schema.pagamento.bandeiraMfe})`;
}
