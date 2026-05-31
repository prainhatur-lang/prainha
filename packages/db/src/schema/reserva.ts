// Reservas de mesa (setor de reservas do concilia).
//
// Pode ser criada manualmente no painel /reservas ou importada de fontes
// externas (ex: Tagme). A importacao usa (filial_id, origem_externa, id_externo)
// pra deduplicar — reimportar nao cria duplicata, faz upsert.

import { pgTable, uuid, text, timestamp, varchar, integer, date, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const reserva = pgTable(
  'reserva',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Nome do cliente. */
    clienteNome: varchar('cliente_nome', { length: 200 }).notNull(),
    /** Telefone/WhatsApp do cliente (so digitos quando possivel). */
    clienteTelefone: varchar('cliente_telefone', { length: 30 }),
    /** Numero de pessoas da reserva. */
    pessoas: integer('pessoas').notNull().default(1),
    /** Data da reserva (YYYY-MM-DD). */
    data: date('data').notNull(),
    /** Hora no formato HH:MM. */
    hora: varchar('hora', { length: 5 }).notNull(),
    /** Workflow: pendente | confirmada | sentada | cancelada | no_show | concluida */
    status: varchar('status', { length: 20 }).notNull().default('pendente'),
    /** Area/salao (ex: "Praia", "Area superior", "Lounge"). */
    area: varchar('area', { length: 100 }),
    /** Mesa (numero/identificacao). */
    mesa: varchar('mesa', { length: 20 }),
    /** Canal de origem: google | instagram | site | telefone | balcao | widget | outro */
    canal: varchar('canal', { length: 30 }).notNull().default('outro'),
    /** Observacao do cliente / da reserva. */
    observacao: text('observacao'),
    /** Sistema de origem quando importada (ex: "tagme"). Null = criada no concilia. */
    origemExterna: varchar('origem_externa', { length: 30 }),
    /** Id da reserva no sistema externo (pra dedupe no import). */
    idExterno: varchar('id_externo', { length: 100 }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialDataIdx: index('reserva_filial_data_idx').on(t.filialId, t.data),
    // Dedupe de import: a mesma reserva externa nao duplica.
    externaUnique: unique('reserva_externa_unique').on(t.filialId, t.origemExterna, t.idExterno),
  }),
);
