// Dados vindos do Consumer (PDV) via agente local
import {
  pgTable,
  uuid,
  integer,
  bigint,
  varchar,
  timestamp,
  numeric,
  smallint,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/**
 * Pagamentos vindos do Consumer.PAGAMENTOS.
 * Uma linha aqui = uma linha na tabela PAGAMENTOS do Firebird local.
 */
export const pagamento = pgTable(
  'pagamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** PAGAMENTOS.CODIGO do Consumer */
    codigoExterno: integer('codigo_externo').notNull(),
    /** PAGAMENTOS.CODIGOPEDIDO */
    codigoPedidoExterno: integer('codigo_pedido_externo'),
    formaPagamento: varchar('forma_pagamento', { length: 255 }),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    percentualTaxa: numeric('percentual_taxa', { precision: 8, scale: 4 }),
    dataPagamento: timestamp('data_pagamento', { withTimezone: true }),
    dataCredito: timestamp('data_credito', { withTimezone: true }),
    nsuTransacao: varchar('nsu_transacao', { length: 50 }),
    numeroAutorizacaoCartao: varchar('numero_autorizacao_cartao', { length: 50 }),
    bandeiraMfe: varchar('bandeira_mfe', { length: 50 }),
    adquirenteMfe: varchar('adquirente_mfe', { length: 255 }),
    nroParcela: smallint('nro_parcela'),
    codigoCredenciadoraCartao: smallint('codigo_credenciadora_cartao'),
    codigoContaCorrente: integer('codigo_conta_corrente'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
    /** quando o agente local detectou update */
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }),
  },
  (t) => ({
    filialCodigoUnique: unique('pagamento_filial_codigo_unique').on(t.filialId, t.codigoExterno),
    filialDataIdx: index('pagamento_filial_data_idx').on(t.filialId, t.dataPagamento),
    nsuIdx: index('pagamento_nsu_idx').on(t.nsuTransacao),
  }),
);

/**
 * Estado de sincronizacao por filial. O agente local mantem seu proprio checkpoint
 * mas o servidor tambem guarda para dashboard e retomada.
 */
export const sincronizacao = pgTable('sincronizacao', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  filialId: uuid('filial_id')
    .notNull()
    .references(() => filial.id, { onDelete: 'cascade' })
    .unique(),
  ultimoCodigoExternoPagamento: integer('ultimo_codigo_externo_pagamento').default(0),
  ultimaSincronizacao: timestamp('ultima_sincronizacao', { withTimezone: true }),
  totalRegistrosSincronizados: bigint('total_registros_sincronizados', { mode: 'number' }).default(
    0,
  ),
});
