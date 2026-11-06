// Conta do Inter de cada pessoa pra pagar a folha pelo arquivo "Folha de
// pagamento" do Inter (dono 05/11/2026). O arquivo do Inter só credita conta
// do próprio Inter e cada pessoa abre a conta no próprio CPF — então quem está
// aqui já cumpre a regra "só paga quem tem o nome na conta".
//
// Entrou pelos PDFs "Dados de Contas Inter" que a E.B. e a Prainha Turismo já
// mandavam pro banco. `empresa` = quem paga ('EB' ou 'PRAINHA').

import { pgTable, uuid, varchar, timestamp, unique, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const contaInterFolha = pgTable(
  'conta_inter_folha',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    empresa: varchar('empresa', { length: 20 }).notNull(),
    /** Só dígitos. */
    cpf: varchar('cpf', { length: 11 }).notNull(),
    nome: text('nome').notNull(),
    /** Como o Inter escreve: "12345678-9". */
    conta: varchar('conta', { length: 20 }).notNull(),
    fonte: text('fonte'),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unico: unique('uq_conta_inter_folha').on(t.empresa, t.cpf),
  }),
);
