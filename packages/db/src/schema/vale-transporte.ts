// Vale transporte quinzenal (pedido do dono 18/10/2026).
//
// Paga ADIANTADO por quinzena (01–15 e 16–fim do mês): dias previstos × valor
// do dia. Na quinzena seguinte o ponto diz quantos dias a pessoa trabalhou de
// fato; a diferença (pagou a mais → abate, pagou a menos → acrescenta) entra
// como acerto na previsão seguinte.
//
// Só a quinzena PAGA é gravada (snapshot imutável do que saiu). Os dias
// trabalhados nunca são gravados: saem do ponto toda vez, então corrigir o
// ponto conserta o acerto da quinzena que ainda não foi paga.

import { pgTable, uuid, varchar, numeric, integer, date, timestamp, boolean, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { filial } from './tenant';
import { funcionario } from './rh';

/** Quem recebe VT e quanto custa o dia (ida + volta, todas as passagens). */
export const vtPessoa = pgTable('vt_pessoa', {
  funcionarioId: uuid('funcionario_id')
    .primaryKey()
    .references(() => funcionario.id, { onDelete: 'cascade' }),
  ativo: boolean('ativo').notNull().default(true),
  valorDia: numeric('valor_dia', { precision: 10, scale: 2 }).notNull(),
  /** Previsão de quem não tem escala fixa (intermitente): dias por semana.
   *  NULL = usa a escala fixa; sem escala, repete os dias da quinzena anterior. */
  diasSemana: integer('dias_semana'),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoPor: uuid('atualizado_por'),
});

/** Quinzena de VT paga numa casa. */
export const vtQuinzena = pgTable(
  'vt_quinzena',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    dataInicio: date('data_inicio').notNull(), // dia 01 ou 16
    dataFim: date('data_fim').notNull(), // dia 15 ou último do mês
    pagaEm: timestamp('paga_em', { withTimezone: true }).notNull().defaultNow(),
    pagaPor: uuid('paga_por'),
  },
  (t) => ({ uniq: unique('uq_vt_quinzena_filial_inicio').on(t.filialId, t.dataInicio) }),
);

/** O que foi pago a cada pessoa na quinzena (valores congelados). */
export const vtQuinzenaItem = pgTable(
  'vt_quinzena_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    quinzenaId: uuid('quinzena_id')
      .notNull()
      .references(() => vtQuinzena.id, { onDelete: 'cascade' }),
    funcionarioId: uuid('funcionario_id')
      .notNull()
      .references(() => funcionario.id, { onDelete: 'cascade' }),
    valorDia: numeric('valor_dia', { precision: 10, scale: 2 }).notNull(),
    diasPrevistos: integer('dias_previstos').notNull(),
    valorPrevisto: numeric('valor_previsto', { precision: 10, scale: 2 }).notNull(),
    /** Saldo que veio da quinzena anterior: + a casa devia, − pagou a mais. */
    acertoAnterior: numeric('acerto_anterior', { precision: 10, scale: 2 }).notNull().default('0'),
    /** max(0, previsto + acerto). O que sobrar negativo carrega pra seguinte. */
    valorPago: numeric('valor_pago', { precision: 10, scale: 2 }).notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_vt_quinzena_item').on(t.quinzenaId, t.funcionarioId),
    porPessoa: index('idx_vt_quinzena_item_pessoa').on(t.funcionarioId),
  }),
);
