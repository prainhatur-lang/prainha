// Snapshots consolidados por filial × mes. Permite apagar dados brutos
// (pedido, pedido_item, pagamento) de periodos antigos sem perder a
// visao historica. Para meses recentes, dashboards continuam usando os
// dados brutos. Para meses antigos, leem dessas tabelas.
//
// Cada registro e' agregado por (filial, ano, mes). Geracao via script
// de migracao OU cron mensal apos fechamento.

import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/**
 * Resumo do mes — 1 row por (filial, ano, mes).
 * Ja inclui breakdowns simples: descontos, acrescimos, servico, qtd pessoas.
 * Para detalhes (top produtos, formas, colaboradores), olhar as tabelas
 * fechamento_mensal_*.
 */
export const fechamentoMensal = pgTable(
  'fechamento_mensal',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    ano: integer('ano').notNull(),
    mes: integer('mes').notNull(),
    /** SUM(pedido.valor_total) — bruto - desconto + acrescimo */
    totalVendas: numeric('total_vendas', { precision: 14, scale: 2 }).notNull().default('0'),
    /** SUM(pedido.valor_total_itens) — antes de desconto/acrescimo */
    totalItens: numeric('total_itens', { precision: 14, scale: 2 }).notNull().default('0'),
    qtdPedidos: integer('qtd_pedidos').notNull().default(0),
    /** SUM(pedido.quantidade_pessoas) */
    qtdPessoas: integer('qtd_pessoas').notNull().default(0),
    ticketMedio: numeric('ticket_medio', { precision: 14, scale: 2 }).notNull().default('0'),
    totalDesconto: numeric('total_desconto', { precision: 14, scale: 2 }).notNull().default('0'),
    totalAcrescimo: numeric('total_acrescimo', { precision: 14, scale: 2 }).notNull().default('0'),
    totalServico: numeric('total_servico', { precision: 14, scale: 2 }).notNull().default('0'),
    totalEntrega: numeric('total_entrega', { precision: 14, scale: 2 }).notNull().default('0'),
    /** SUM(pagamento.valor) — pode diferir de totalVendas (gap = comanda em aberto, etc) */
    totalPagamentos: numeric('total_pagamentos', { precision: 14, scale: 2 }).notNull().default('0'),
    qtdPagamentos: integer('qtd_pagamentos').notNull().default(0),
    geradoEm: timestamp('gerado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_fech_mes_filial').on(t.filialId, t.ano, t.mes),
    filialIdx: index('idx_fech_mes_filial').on(t.filialId, t.ano, t.mes),
  }),
);

/** Total por forma de pagamento, por filial × mes. */
export const fechamentoMensalForma = pgTable(
  'fechamento_mensal_forma',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    ano: integer('ano').notNull(),
    mes: integer('mes').notNull(),
    formaPagamento: varchar('forma_pagamento', { length: 100 }).notNull(),
    qtd: integer('qtd').notNull().default(0),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull().default('0'),
    geradoEm: timestamp('gerado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_fech_mes_forma').on(t.filialId, t.ano, t.mes, t.formaPagamento),
    filialIdx: index('idx_fech_mes_forma_filial').on(t.filialId, t.ano, t.mes),
  }),
);

/** Top 100 produtos do mes por filial. Ranking ordenado por valor_total. */
export const fechamentoMensalProduto = pgTable(
  'fechamento_mensal_produto',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    ano: integer('ano').notNull(),
    mes: integer('mes').notNull(),
    /** Posicao no ranking do mes (1-100) */
    posicao: integer('posicao').notNull(),
    codigoProdutoExterno: integer('codigo_produto_externo'),
    nomeProduto: varchar('nome_produto', { length: 200 }),
    qtd: numeric('qtd', { precision: 14, scale: 3 }).notNull().default('0'),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull().default('0'),
    geradoEm: timestamp('gerado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_fech_mes_prod').on(t.filialId, t.ano, t.mes, t.posicao),
    filialIdx: index('idx_fech_mes_prod_filial').on(t.filialId, t.ano, t.mes),
  }),
);

/** Total vendido por colaborador (vendedor/garçom), por filial × mes. */
export const fechamentoMensalColaborador = pgTable(
  'fechamento_mensal_colaborador',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    ano: integer('ano').notNull(),
    mes: integer('mes').notNull(),
    codigoColaborador: integer('codigo_colaborador'),
    /** Nome capturado no momento do snapshot (pode mudar depois). */
    nomeColaborador: varchar('nome_colaborador', { length: 200 }),
    qtdPedidos: integer('qtd_pedidos').notNull().default(0),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull().default('0'),
    geradoEm: timestamp('gerado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_fech_mes_colab').on(t.filialId, t.ano, t.mes, t.codigoColaborador),
    filialIdx: index('idx_fech_mes_colab_filial').on(t.filialId, t.ano, t.mes),
  }),
);
