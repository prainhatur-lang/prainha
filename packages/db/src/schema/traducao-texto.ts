// Tradução de textos públicos (delivery por enquanto): nome de categoria, de
// prato, descrição, pergunta e opção do monta-prato. Uma linha por texto em
// português — a mesma tradução serve pras 3 casas, então a tabela não tem
// filial. A chave é o md5 do texto já sem espaço nas pontas; mudou o texto no
// cadastro, muda a chave e a tradução nova nasce sozinha (a velha fica parada).
// Quem grava é lib/traduzir-cardapio.ts, depois da página responder.

import { pgTable, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const traducaoTexto = pgTable('traducao_texto', {
  /** md5 do texto em português (trim) */
  chave: varchar('chave', { length: 32 }).primaryKey(),
  pt: text('pt').notNull(),
  en: text('en').notNull(),
  es: text('es').notNull(),
  fr: text('fr').notNull(),
  it: text('it').notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
