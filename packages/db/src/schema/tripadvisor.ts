// TripAdvisor de cada casa, lido da API oficial (Terra, plano Discover).
// - tripadvisor_resumo: uma foto por casa por dia (nota, total, distribuição) —
//   é o que deixa ver a evolução ("+7 em 7 dias").
// - tripadvisor_avaliacao: as avaliações que a API entregou. O plano só devolve
//   as 3 mais recentes por leitura, então a lista cresce uma leitura por vez.
// Quem grava é o cron /api/cron/tripadvisor (lib/tripadvisor.ts); a tela é
// /avaliacoes. O id do local sai do link filial.tripadvisor_review_url.

import { pgTable, uuid, varchar, text, date, numeric, integer, bigint, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/** Nota por quesito (atendimento, comida, ambiente, custo). */
export interface TripadvisorSubnota {
  tipo: string;
  nome: string;
  nota: number;
  total: number;
}

export const tripadvisorResumo = pgTable(
  'tripadvisor_resumo',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** dia da leitura (BRT) */
    dia: date('dia').notNull(),
    /** id do local no TripAdvisor (o d123 do link) */
    locationId: integer('location_id').notNull(),
    /** nota geral; null enquanto a casa não tem avaliação publicada */
    nota: numeric('nota', { precision: 3, scale: 1 }),
    total: integer('total').notNull().default(0),
    /** quantas avaliações de cada nota: { "1": n, ..., "5": n } */
    distribuicao: jsonb('distribuicao').$type<Record<string, number>>(),
    subnotas: jsonb('subnotas').$type<TripadvisorSubnota[]>(),
    /** página da casa no TripAdvisor, do jeito que a API manda */
    paginaUrl: text('pagina_url'),
    lidoEm: timestamp('lido_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tripadvisor_resumo_filial_dia_uq').on(t.filialId, t.dia)],
);

export const tripadvisorAvaliacao = pgTable(
  'tripadvisor_avaliacao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** id da avaliação no TripAdvisor */
    reviewId: bigint('review_id', { mode: 'number' }).notNull(),
    nota: integer('nota').notNull(),
    titulo: text('titulo'),
    texto: text('texto'),
    idioma: varchar('idioma', { length: 12 }),
    usuario: varchar('usuario', { length: 120 }),
    publicadoEm: timestamp('publicado_em', { withTimezone: true }),
    /** mês da visita, como o TripAdvisor manda ('YYYY-MM') */
    viagem: varchar('viagem', { length: 10 }),
    url: text('url'),
    /** a casa já respondeu no TripAdvisor */
    respondida: boolean('respondida').notNull().default(false),
    respostaTexto: text('resposta_texto'),
    /** primeira vez que a leitura trouxe esta avaliação */
    vistoEm: timestamp('visto_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tripadvisor_avaliacao_filial_review_uq').on(t.filialId, t.reviewId),
    index('tripadvisor_avaliacao_filial_pub_idx').on(t.filialId, t.publicadoEm),
  ],
);
