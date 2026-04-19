// Resultado das conciliacoes
import { pgTable, uuid, varchar, timestamp, numeric, jsonb, index, text, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { pagamento } from './pdv';

/**
 * Estado de conciliacao por pagamento (registro do PDV).
 * Cada pagamento tem 1 status atual de conciliacao.
 */
export const conciliacaoPagamento = pgTable(
  'conciliacao_pagamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pagamentoId: uuid('pagamento_id')
      .notNull()
      .references(() => pagamento.id, { onDelete: 'cascade' })
      .unique(),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** etapa atual: COMPLETO | NAO_NA_CIELO_VENDA | SEM_AGENDA_RECEBIVEL | NAO_PAGO_NO_BANCO | DIVERGENCIA_VALOR */
    etapa: varchar('etapa', { length: 30 }).notNull(),
    vendaAdquirenteId: uuid('venda_adquirente_id'),
    recebivelAdquirenteId: uuid('recebivel_adquirente_id'),
    /** lista de IDs de lancamento_banco que cobrem este pagamento */
    lancamentosBancoIds: jsonb('lancamentos_banco_ids').$type<string[]>(),
    valorDivergencia: numeric('valor_divergencia', { precision: 14, scale: 2 }),
    detalhes: jsonb('detalhes').$type<Record<string, unknown>>(),
    rodadoEm: timestamp('rodado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialEtapaIdx: index('conc_filial_etapa_idx').on(t.filialId, t.etapa),
  }),
);

/**
 * Excecoes acionaveis para o dashboard. Cada uma representa um problema
 * que precisa de atencao humana (ou aceite explicito).
 */
export const excecao = pgTable(
  'excecao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** qual processo de conciliacao gerou: OPERADORA | BANCO */
    processo: varchar('processo', { length: 20 }),
    /** referencia ao pagamento que gerou (se aplicavel) */
    pagamentoId: uuid('pagamento_id').references(() => pagamento.id, { onDelete: 'cascade' }),
    /** referencia a venda Cielo (quando excecao eh sobre a venda) */
    vendaAdquirenteId: uuid('venda_adquirente_id'),
    /** referencia a recebivel Cielo */
    recebivelAdquirenteId: uuid('recebivel_adquirente_id'),
    /** referencia a lancamento bancario */
    lancamentoBancoId: uuid('lancamento_banco_id'),
    tipo: varchar('tipo', { length: 50 }).notNull(),
    severidade: varchar('severidade', { length: 20 }).notNull(),
    descricao: text('descricao').notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }),
    detectadoEm: timestamp('detectado_em', { withTimezone: true }).notNull().defaultNow(),
    /** se foi reconhecida pelo usuario */
    aceitaEm: timestamp('aceita_em', { withTimezone: true }),
    aceitaPor: uuid('aceita_por'),
    observacao: text('observacao'),
  },
  (t) => ({
    filialIdx: index('excecao_filial_idx').on(t.filialId, t.detectadoEm),
    abertasIdx: index('excecao_abertas_idx').on(t.filialId).where(sql`aceita_em IS NULL`),
    processoIdx: index('excecao_processo_idx').on(t.filialId, t.processo),
  }),
);

/**
 * Fechamento de periodo: trava um dia/processo/filial. Apos fechar, o engine
 * nao reprocessa pagamentos desse dia e as excecoes ficam read-only.
 * Granularidade eh dia (um registro por dia). Soh DONO pode fechar/reabrir.
 */
export const fechamentoConciliacao = pgTable(
  'fechamento_conciliacao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** OPERADORA | RECEBIVEIS | BANCO */
    processo: varchar('processo', { length: 20 }).notNull(),
    /** Dia trancado (data da transacao). */
    data: date('data').notNull(),
    fechadoEm: timestamp('fechado_em', { withTimezone: true }).notNull().defaultNow(),
    fechadoPor: uuid('fechado_por'),
    observacao: text('observacao'),
  },
  (t) => ({
    uniq: index('fechamento_unique_idx').on(t.filialId, t.processo, t.data),
    filialIdx: index('fechamento_filial_idx').on(t.filialId, t.processo),
  }),
);

/**
 * Cada execucao do job de conciliacao gera um relatorio.
 */
export const execucaoConciliacao = pgTable('execucao_conciliacao', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  filialId: uuid('filial_id')
    .notNull()
    .references(() => filial.id, { onDelete: 'cascade' }),
  /** OPERADORA | BANCO | legado: null = trace antigo */
  processo: varchar('processo', { length: 20 }),
  /** periodo que foi conciliado */
  dataInicio: timestamp('data_inicio', { withTimezone: true }),
  dataFim: timestamp('data_fim', { withTimezone: true }),
  iniciadoEm: timestamp('iniciado_em', { withTimezone: true }).notNull().defaultNow(),
  finalizadoEm: timestamp('finalizado_em', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull().default('EM_ANDAMENTO'),
  resumo: jsonb('resumo').$type<Record<string, unknown>>(),
  erro: text('erro'),
});
