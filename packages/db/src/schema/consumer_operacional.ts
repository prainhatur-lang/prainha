// Tabelas operacionais espelhadas do Consumer: caixa, estoque, delivery,
// integracoes externas (iFood, MenuDino, OrderIntegration).

import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  numeric,
  smallint,
  timestamp,
  text,
  index,
  unique,
  char,
  boolean,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { produto } from './vendas';
import { pedido, pedidoItem } from './vendas';

// ============ CAIXA ============

export const caixa = pgTable(
  'caixa',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoUsuario: integer('codigo_usuario'),
    dataAbertura: timestamp('data_abertura', { withTimezone: true }),
    dataFechamento: timestamp('data_fechamento', { withTimezone: true }),
    saldoInicial: numeric('saldo_inicial', { precision: 14, scale: 4 }),
    saldoFinal: numeric('saldo_final', { precision: 14, scale: 4 }),
    saldoFinalInformado: numeric('saldo_final_informado', { precision: 14, scale: 4 }),
    observacao: varchar('observacao', { length: 255 }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_caixa_filial_codigo').on(t.filialId, t.codigoExterno),
    dataIdx: index('idx_caixa_data').on(t.filialId, t.dataAbertura),
  }),
);

export const caixaOperacao = pgTable(
  'caixa_operacao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoCaixa: integer('codigo_caixa'),
    caixaId: uuid('caixa_id').references(() => caixa.id, { onDelete: 'cascade' }),
    codigoFormaPagamento: integer('codigo_forma_pagamento'),
    codigoContasPagar: integer('codigo_contas_pagar'),
    dataOperacao: timestamp('data_operacao', { withTimezone: true }),
    valorEntrada: numeric('valor_entrada', { precision: 14, scale: 4 }),
    valorSaida: numeric('valor_saida', { precision: 14, scale: 4 }),
    tipo: char('tipo', { length: 1 }),
    observacao: varchar('observacao', { length: 200 }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_caixaop_filial_codigo').on(t.filialId, t.codigoExterno),
    caixaIdx: index('idx_caixaop_caixa').on(t.filialId, t.codigoCaixa),
  }),
);

// ============ ESTOQUE Consumer (replica fiel) ============

export const consumerEstoque = pgTable(
  'consumer_estoque',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoProdutoExterno: integer('codigo_produto_externo'),
    produtoId: uuid('produto_id').references(() => produto.id, { onDelete: 'set null' }),
    dataCadastro: timestamp('data_cadastro', { withTimezone: true }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqCodigo: unique('uq_consumer_estoque_filial_codigo').on(t.filialId, t.codigoExterno) }),
);

export const consumerEstoqueMovimentacao = pgTable(
  'consumer_estoque_movimentacao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoProdutoDetalhe: integer('codigo_produto_detalhe'),
    codigoItemPedido: integer('codigo_item_pedido'),
    codigoUsuario: integer('codigo_usuario'),
    qtdInicial: numeric('qtd_inicial', { precision: 14, scale: 4 }),
    qtd: numeric('qtd', { precision: 14, scale: 4 }),
    qtdFinal: numeric('qtd_final', { precision: 14, scale: 4 }),
    valorCompra: numeric('valor_compra', { precision: 14, scale: 4 }),
    tipo: char('tipo', { length: 1 }),
    observacao: varchar('observacao', { length: 255 }),
    codigoMovimentacaoEstorno: integer('codigo_movimentacao_estorno'),
    dataInsert: timestamp('data_insert', { withTimezone: true }),
    dataUpdate: timestamp('data_update', { withTimezone: true }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_cem_filial_codigo').on(t.filialId, t.codigoExterno),
    detalheIdx: index('idx_cem_detalhe').on(t.filialId, t.codigoProdutoDetalhe),
    dataIdx: index('idx_cem_data').on(t.filialId, t.dataInsert),
  }),
);

// ============ DELIVERY ============

export const taxaEntrega = pgTable(
  'taxa_entrega',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    descricao: varchar('descricao', { length: 200 }),
    valor: numeric('valor', { precision: 14, scale: 2 }),
    tempoMinutos: integer('tempo_minutos'),
    pausaTemporariaInicio: timestamp('pausa_temporaria_inicio', { withTimezone: true }),
    pausaTemporariaFim: timestamp('pausa_temporaria_fim', { withTimezone: true }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqCodigo: unique('uq_taxaentrega_filial_codigo').on(t.filialId, t.codigoExterno) }),
);

export const taxaEntregaCep = pgTable(
  'taxa_entrega_cep',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoTaxaEntrega: integer('codigo_taxa_entrega'),
    taxaEntregaId: uuid('taxa_entrega_id').references(() => taxaEntrega.id, { onDelete: 'cascade' }),
    cepInicial: varchar('cep_inicial', { length: 10 }),
    cepFinal: varchar('cep_final', { length: 10 }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqCodigo: unique('uq_tec_filial_codigo').on(t.filialId, t.codigoExterno) }),
);

export const grupoEntrega = pgTable(
  'grupo_entrega',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    descricao: varchar('descricao', { length: 200 }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqCodigo: unique('uq_grupoentrega_filial_codigo').on(t.filialId, t.codigoExterno) }),
);

export const endereco = pgTable(
  'endereco',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoContato: integer('codigo_contato'),
    codigoTaxaEntrega: integer('codigo_taxa_entrega'),
    principal: boolean('principal'),
    lat: numeric('lat', { precision: 10, scale: 7 }),
    lon: numeric('lon', { precision: 10, scale: 7 }),
    cep: varchar('cep', { length: 10 }),
    logradouro: varchar('logradouro', { length: 200 }),
    numero: varchar('numero', { length: 10 }),
    complemento: varchar('complemento', { length: 200 }),
    bairro: varchar('bairro', { length: 100 }),
    cidade: varchar('cidade', { length: 100 }),
    uf: varchar('uf', { length: 2 }),
    descricao: varchar('descricao', { length: 200 }),
    referencia: varchar('referencia', { length: 250 }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_endereco_filial_codigo').on(t.filialId, t.codigoExterno),
    contatoIdx: index('idx_endereco_contato').on(t.filialId, t.codigoContato),
  }),
);

export const delivery = pgTable(
  'delivery',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** PK do Consumer eh CODIGOPEDIDO (1:1 com pedido). */
    codigoPedidoExterno: integer('codigo_pedido_externo').notNull(),
    pedidoId: uuid('pedido_id').references(() => pedido.id, { onDelete: 'cascade' }),
    codigoContato: integer('codigo_contato'),
    codigoEndereco: integer('codigo_endereco'),
    enderecoId: uuid('endereco_id').references(() => endereco.id, { onDelete: 'set null' }),
    codigoTaxaEntrega: integer('codigo_taxa_entrega'),
    codigoTipoEntrega: integer('codigo_tipo_entrega'),
    preparoPrevistoEm: timestamp('preparo_previsto_em', { withTimezone: true }),
    preparoIniciadoEm: timestamp('preparo_iniciado_em', { withTimezone: true }),
    saiuEntregaEm: timestamp('saiu_entrega_em', { withTimezone: true }),
    entregaPrevistaEm: timestamp('entrega_prevista_em', { withTimezone: true }),
    entregueEm: timestamp('entregue_em', { withTimezone: true }),
    retiradaPrevistaEm: timestamp('retirada_prevista_em', { withTimezone: true }),
    retiradoEm: timestamp('retirado_em', { withTimezone: true }),
    prontoParaRetiradaEm: timestamp('pronto_para_retirada_em', { withTimezone: true }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqCodigo: unique('uq_delivery_filial_pedido').on(t.filialId, t.codigoPedidoExterno) }),
);

export const pedidoGrupoEntrega = pgTable(
  'pedido_grupo_entrega',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoPedidoExterno: integer('codigo_pedido_externo').notNull(),
    pedidoId: uuid('pedido_id').references(() => pedido.id, { onDelete: 'cascade' }),
    codigoGrupoEntrega: integer('codigo_grupo_entrega'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqCodigo: unique('uq_pge_filial_pedido').on(t.filialId, t.codigoPedidoExterno) }),
);

// ============ ITEMPEDIDOFICHA ============

export const pedidoItemFicha = pgTable(
  'pedido_item_ficha',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoItemPedido: integer('codigo_item_pedido'),
    pedidoItemId: uuid('pedido_item_id').references(() => pedidoItem.id, { onDelete: 'cascade' }),
    codigoProdutoDetalhe: integer('codigo_produto_detalhe'),
    codigoColaborador: integer('codigo_colaborador'),
    dataInsert: timestamp('data_insert', { withTimezone: true }),
    dataUpdate: timestamp('data_update', { withTimezone: true }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_pif_filial_codigo').on(t.filialId, t.codigoExterno),
    itemIdx: index('idx_pif_item').on(t.filialId, t.codigoItemPedido),
  }),
);

// ============ INTEGRACAO EXTERNA (iFood, MenuDino, OrderIntegration) ============

export const ifoodPedido = pgTable(
  'ifood_pedido',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** PK do Consumer (varchar) */
    codigoPedidoIfood: varchar('codigo_pedido_ifood', { length: 255 }).notNull(),
    codigoPedidoConsumer: integer('codigo_pedido_consumer'),
    pedidoId: uuid('pedido_id').references(() => pedido.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 255 }),
    statusItens: varchar('status_itens', { length: 50 }),
    cancelamentoStatus: varchar('cancelamento_status', { length: 30 }),
    observacoes: varchar('observacoes', { length: 255 }),
    payloadJson: text('payload_json'),
    dataInsert: timestamp('data_insert', { withTimezone: true }),
    dataUpdate: timestamp('data_update', { withTimezone: true }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqCodigo: unique('uq_ifood_filial_codigo').on(t.filialId, t.codigoPedidoIfood) }),
);

export const menudinoPedido = pgTable(
  'menudino_pedido',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** PK do Consumer (bigint) */
    codigoPedidoMenudino: bigint('codigo_pedido_menudino', { mode: 'bigint' }).notNull(),
    codigoPedidoConsumer: integer('codigo_pedido_consumer'),
    pedidoId: uuid('pedido_id').references(() => pedido.id, { onDelete: 'set null' }),
    guidPedidoMenudino: varchar('guid_pedido_menudino', { length: 255 }),
    status: varchar('status', { length: 255 }),
    statusItens: varchar('status_itens', { length: 50 }),
    observacoes: varchar('observacoes', { length: 255 }),
    payloadJson: text('payload_json'),
    dataInsert: timestamp('data_insert', { withTimezone: true }),
    dataUpdate: timestamp('data_update', { withTimezone: true }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqCodigo: unique('uq_menudino_filial_codigo').on(t.filialId, t.codigoPedidoMenudino) }),
);

export const orderIntegration = pgTable(
  'order_integration',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** PK do Consumer (integer) */
    integrationId: integer('integration_id').notNull(),
    externalId: varchar('external_id', { length: 100 }),
    providerOrigin: smallint('provider_origin'),
    localOrderId: integer('local_order_id'),
    pedidoId: uuid('pedido_id').references(() => pedido.id, { onDelete: 'set null' }),
    insertedAt: timestamp('inserted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqId: unique('uq_orderintegration_filial_id').on(t.filialId, t.integrationId) }),
);

export const orderShipping = pgTable(
  'order_shipping',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    shippingId: integer('shipping_id').notNull(),
    orderIntegrationId: integer('order_integration_id'),
    localOrderId: integer('local_order_id'),
    pedidoId: uuid('pedido_id').references(() => pedido.id, { onDelete: 'set null' }),
    externalId: varchar('external_id', { length: 50 }),
    providerOrigin: smallint('provider_origin'),
    trackingUrl: varchar('tracking_url', { length: 200 }),
    method: varchar('method', { length: 50 }),
    brand: varchar('brand', { length: 50 }),
    value: numeric('value', { precision: 14, scale: 4 }),
    insertedAt: timestamp('inserted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqId: unique('uq_ordershipping_filial_id').on(t.filialId, t.shippingId) }),
);

