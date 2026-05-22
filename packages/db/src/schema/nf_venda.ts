// NFe e NFCe de VENDA emitidas pelo Consumer (espelho das tabelas NFE / NFCE /
// NFITEM / NFPAGAMENTO do Firebird).
//
// Unifica NFE + NFCE numa unica tabela `nf_venda` com discriminador `tipo`
// (decisao D5 do CDC v2 — ver memory/consumer_decisoes_finais_cdc.md).
// Items e pagamentos viram tabelas filhas linkadas via `codNfInfo` (campo
// do Consumer que casa cabecalho com items/pagamentos) + FK resolvida pra
// `nf_venda.id` apos insert.

import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  numeric,
  smallint,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { pedido, pedidoItem } from './vendas';
import { pagamento } from './pdv';

/** Cabecalho de NFe e NFCe de venda (saida). */
export const nfVenda = pgTable(
  'nf_venda',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** Discriminador: NFE ou NFCE */
    tipo: varchar('tipo', { length: 4 }).notNull(),
    /** NFE.CODIGO ou NFCE.CODIGO — PK do Consumer (bigint) */
    codigoExterno: bigint('codigo_externo', { mode: 'bigint' }).notNull(),
    /** NFE.CODIGOPEDIDO ou NFCE.PEDIDO — FK pra pedido */
    codigoPedidoExterno: integer('codigo_pedido_externo'),
    pedidoId: uuid('pedido_id').references(() => pedido.id, { onDelete: 'set null' }),
    /** Codigo que liga ao NFITEM e NFPAGAMENTO (campo CODNFINFO do Consumer) */
    codNfInfo: bigint('cod_nf_info', { mode: 'bigint' }),
    serie: smallint('serie'),
    numero: integer('numero'),
    chaveAcesso: varchar('chave_acesso', { length: 44 }),
    /** NFE.CODIGOSITUACAO ou NFCE.SITUACAONFCE */
    situacao: smallint('situacao'),
    dataHoraEmissao: timestamp('data_hora_emissao', { withTimezone: true }),
    /** Valor total do documento */
    valor: numeric('valor', { precision: 14, scale: 4 }),
    /** Soh NFCE */
    subtotal: numeric('subtotal', { precision: 14, scale: 4 }),
    /** Soh NFCE */
    acrescimo: numeric('acrescimo', { precision: 14, scale: 4 }),
    /** Soh NFCE */
    desconto: numeric('desconto', { precision: 14, scale: 4 }),
    /** Soh NFCE */
    tipoEmissao: smallint('tipo_emissao'),
    /** Soh NFE — CPF/CNPJ destinatario */
    numeroDocumentoDestinatario: varchar('numero_documento_destinatario', { length: 20 }),
    /** Soh NFE — TIPODOCUMENTODESTINATARIO */
    codigoTipoDocumento: smallint('codigo_tipo_documento'),
    codigoNumericoAleatorio: integer('codigo_numerico_aleatorio'),
    protocoloCancelamento: bigint('protocolo_cancelamento', { mode: 'bigint' }),
    numeroProtocolo: varchar('numero_protocolo', { length: 50 }),
    justificativaCancelamento: varchar('justificativa_cancelamento', { length: 255 }),
    codigoEstacao: smallint('codigo_estacao'),
    consolidadoEm: timestamp('consolidado_em', { withTimezone: true }),
    caminhoXml: varchar('caminho_xml', { length: 400 }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_nfvenda_filial_tipo_codigo').on(t.filialId, t.tipo, t.codigoExterno),
    pedidoIdx: index('idx_nfvenda_pedido').on(t.filialId, t.codigoPedidoExterno),
    chaveIdx: index('idx_nfvenda_chave').on(t.chaveAcesso),
    nfInfoIdx: index('idx_nfvenda_nfinfo').on(t.codNfInfo),
    dataIdx: index('idx_nfvenda_data').on(t.filialId, t.dataHoraEmissao),
  }),
);

/** Item da NF (NFITEM no Consumer). Liga ao cabecalho via CODNFINFO. */
export const nfVendaItem = pgTable(
  'nf_venda_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: bigint('codigo_externo', { mode: 'bigint' }).notNull(),
    codNfInfo: bigint('cod_nf_info', { mode: 'bigint' }).notNull(),
    nfVendaId: uuid('nf_venda_id').references(() => nfVenda.id, { onDelete: 'cascade' }),
    /** Ref pra PRODUTODETALHE (variante vendida) */
    codProdutoDetalhe: integer('cod_produto_detalhe'),
    /** Ref pra ITENSPEDIDO */
    codItemPedido: integer('cod_item_pedido'),
    pedidoItemId: uuid('pedido_item_id').references(() => pedidoItem.id, { onDelete: 'set null' }),
    /** H02 — numero do item na NF */
    nItem: smallint('n_item'),
    cfop: smallint('cfop'),
    /** I10 — quantidade comercial */
    qCom: numeric('q_com', { precision: 14, scale: 4 }),
    /** I10A — valor unitario comercial */
    vUnCom: numeric('v_un_com', { precision: 14, scale: 4 }),
    /** I11 — valor total do produto */
    vProd: numeric('v_prod', { precision: 14, scale: 2 }),
    /** I14 — quantidade tributavel */
    qTrib: numeric('q_trib', { precision: 14, scale: 4 }),
    /** I14A — valor unitario tributavel */
    vUnTrib: numeric('v_un_trib', { precision: 14, scale: 4 }),
    /** I15 — frete */
    vFrete: numeric('v_frete', { precision: 14, scale: 2 }),
    /** I16 — seguro */
    vSeg: numeric('v_seg', { precision: 14, scale: 2 }),
    /** I17 — desconto */
    vDesc: numeric('v_desc', { precision: 14, scale: 2 }),
    /** I17A — outras despesas */
    vOutro: numeric('v_outro', { precision: 14, scale: 2 }),
    /** I17B — indicador soma total */
    indTot: smallint('ind_tot'),
    /** M02 — total tributos */
    vTotTrib: numeric('v_tot_trib', { precision: 14, scale: 2 }),
    /** I02 — codigo do produto */
    cProd: varchar('c_prod', { length: 60 }),
    /** I04 — descricao do produto */
    xProd: varchar('x_prod', { length: 120 }),
    /** V01 — informacao adicional do produto */
    infAdProd: varchar('inf_ad_prod', { length: 500 }),
    /** VB01 — valor item */
    vItem: numeric('v_item', { precision: 14, scale: 2 }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_nfvendaitem_filial_codigo').on(t.filialId, t.codigoExterno),
    nfInfoIdx: index('idx_nfvendaitem_nfinfo').on(t.codNfInfo),
    pedidoItemIdx: index('idx_nfvendaitem_pedidoitem').on(t.codItemPedido),
  }),
);

/** Pagamento associado a NF (NFPAGAMENTO no Consumer). */
export const nfVendaPagamento = pgTable(
  'nf_venda_pagamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: bigint('codigo_externo', { mode: 'bigint' }).notNull(),
    codNfInfo: bigint('cod_nf_info', { mode: 'bigint' }).notNull(),
    nfVendaId: uuid('nf_venda_id').references(() => nfVenda.id, { onDelete: 'cascade' }),
    /** CODPAGAMENTO — FK pra PAGAMENTOS */
    codPagamento: integer('cod_pagamento'),
    pagamentoId: uuid('pagamento_id').references(() => pagamento.id, { onDelete: 'set null' }),
    /** YA01B — indicador de pagamento (0=vista, 1=prazo) */
    indPag: smallint('ind_pag'),
    /** YA02 — tipo de pagamento (codigo SEFAZ) */
    tPag: smallint('t_pag'),
    /** YA03 — valor pago */
    vPag: numeric('v_pag', { precision: 14, scale: 2 }),
    /** YA04A — tipo integracao (1=integrado, 2=nao integrado) */
    tpIntegra: smallint('tp_integra'),
    /** YA06 — bandeira */
    tBand: smallint('t_band'),
    /** WA05 — codigo SAT da administradora cartao */
    cAdmCsat: smallint('c_adm_csat'),
    /** YA05 — CNPJ administradora */
    cnpj: varchar('cnpj', { length: 14 }),
    /** YA02A — descricao do meio de pagamento (livre) */
    xPag: varchar('x_pag', { length: 60 }),
    /** YA07 — codigo autorizacao */
    cAut: varchar('c_aut', { length: 20 }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_nfvendapag_filial_codigo').on(t.filialId, t.codigoExterno),
    nfInfoIdx: index('idx_nfvendapag_nfinfo').on(t.codNfInfo),
  }),
);
