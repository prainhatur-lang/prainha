// Evento com prato "de ticket": o prato entra na mesa por R$ 0,01 e cada um vale
// um ticket que a casa recebe por fora (ex.: R$ 70), de quem contratou o evento.
// - O cadastro guarda casa, dia, nome, quem paga, valor do ticket e quais pratos
//   contam — a tela /relatorios/evento deixa de depender do que está na URL.
// - Ao ENCERRAR, a contagem do PDV vira foto (pratos × ticket) e o evento entra
//   na lista "a receber" no nome de quem paga, até o dinheiro entrar.

import { pgTable, uuid, varchar, text, date, numeric, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/** Um dinheiro que entrou por conta dos tickets do evento. */
export interface RecebimentoEventoTicket {
  /** dia em que entrou (YYYY-MM-DD) */
  data: string;
  valor: number;
  /** pix, dinheiro, transferência, boleto… (texto livre) */
  forma?: string | null;
  observacao?: string | null;
  /** quem registrou (auth.users.id) e quando (ISO) */
  por?: string | null;
  em: string;
}

export const eventoTicket = pgTable(
  'evento_ticket',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** dia operacional do evento (05:00 → 05:00) */
    dia: date('dia').notNull(),
    nome: varchar('nome', { length: 120 }).notNull(),
    /** quem paga os tickets (empresa, agência, grupo) */
    pagador: varchar('pagador', { length: 160 }),
    valorTicket: numeric('valor_ticket', { precision: 12, scale: 2 }).notNull(),
    /** códigos (produto.codigo_externo) dos pratos de R$ 0,01 que contam */
    produtos: jsonb('produtos').$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    /** quantos convidados (pratos) foram combinados — pra conferir com o que saiu */
    convidados: integer('convidados'),
    observacao: text('observacao'),
    /** 'ABERTO' (contando) | 'ENCERRADO' (a receber) | 'RECEBIDO' */
    status: varchar('status', { length: 12 }).notNull().default('ABERTO'),
    /** foto tirada ao encerrar */
    pratos: numeric('pratos', { precision: 12, scale: 3 }),
    valorTickets: numeric('valor_tickets', { precision: 14, scale: 2 }),
    valorPdv: numeric('valor_pdv', { precision: 14, scale: 2 }),
    encerradoEm: timestamp('encerrado_em', { withTimezone: true }),
    encerradoPor: uuid('encerrado_por'),
    recebimentos: jsonb('recebimentos').$type<RecebimentoEventoTicket[]>().notNull().default(sql`'[]'::jsonb`),
    valorRecebido: numeric('valor_recebido', { precision: 14, scale: 2 }).notNull().default('0'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    criadoPor: uuid('criado_por'),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('evento_ticket_filial_dia_idx').on(t.filialId, t.dia), index('evento_ticket_status_idx').on(t.status)],
);
