// Lista de espera da recepcao: clientes que chegam SEM reserva entram numa fila
// por quantidade de pessoas. O atendente chama (avisa por WhatsApp), senta ou
// marca desistencia. E por filial e por momento (fila do dia).

import { pgTable, uuid, varchar, integer, text, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const listaEspera = pgTable(
  'lista_espera',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Nome do cliente / grupo. */
    nome: varchar('nome', { length: 200 }).notNull(),
    /** WhatsApp (so digitos quando possivel) — pra avisar que a mesa ficou pronta. */
    telefone: varchar('telefone', { length: 30 }),
    /** Quantidade de pessoas do grupo. */
    pessoas: integer('pessoas').notNull().default(1),
    /** Workflow: aguardando | chamado | sentado | desistiu */
    status: varchar('status', { length: 20 }).notNull().default('aguardando'),
    /** Area/salao preferido (opcional). */
    area: varchar('area', { length: 100 }),
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    /** Quando o grupo foi chamado (mesa pronta). */
    chamadoEm: timestamp('chamado_em', { withTimezone: true }),
    /** Quando o grupo sentou. */
    sentadoEm: timestamp('sentado_em', { withTimezone: true }),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialStatusIdx: index('idx_lista_espera_filial_status').on(t.filialId, t.status),
    criadoIdx: index('idx_lista_espera_criado').on(t.criadoEm),
  }),
);
