// Estudo de equipe mês a mês (pedido do dono 10/11/2026): por casa e por mês,
// o retrato do cálculo (resumo), a última análise da IA e a decisão que o
// gerente/dono registrou. Uma linha por casa e mês. RLS habilitado.

import { pgTable, uuid, varchar, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { filial } from './tenant';

export const rhEstudoEquipe = pgTable(
  'rh_estudo_equipe',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** 'YYYY-MM' */
    competencia: varchar('competencia', { length: 7 }).notNull(),
    /** Resumo do cálculo no momento da análise (pra comparar depois). */
    dados: jsonb('dados'),
    analise: text('analise'),
    analiseEm: timestamp('analise_em', { withTimezone: true }),
    analisePor: text('analise_por'),
    decisao: text('decisao'),
    decisaoEm: timestamp('decisao_em', { withTimezone: true }),
    decisaoPor: text('decisao_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_rh_estudo_equipe').on(t.filialId, t.competencia)],
);
