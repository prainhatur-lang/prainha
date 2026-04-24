// Notas fiscais de entrada (NF-e de fornecedor que voce recebe).
// Upload manual (XML) na Fase 1; SEFAZ Manifesto/Distribuicao DF-e na Fase 2.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  date,
  numeric,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { fornecedor } from './financeiro';
import { produto } from './vendas';

/** Cabecalho da NF-e de entrada. Chave de acesso e' identificador global. */
export const notaCompra = pgTable(
  'nota_compra',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** Chave de 44 digitos — unica globalmente */
    chave: varchar('chave', { length: 44 }).notNull(),
    modelo: integer('modelo'), // 55 = NFe, 65 = NFCe, 01 = NF avulsa, etc
    serie: integer('serie'),
    numero: integer('numero'),
    /** 1 = Entrada, 2 = Saida (do ponto de vista do emitente) */
    tipoOperacao: integer('tipo_operacao'),
    naturezaOperacao: varchar('natureza_operacao', { length: 200 }),

    // Emitente (fornecedor)
    emitCnpj: varchar('emit_cnpj', { length: 14 }),
    emitNome: varchar('emit_nome', { length: 200 }),
    emitFantasia: varchar('emit_fantasia', { length: 200 }),
    emitIe: varchar('emit_ie', { length: 30 }),
    emitUf: varchar('emit_uf', { length: 2 }),
    emitCidade: varchar('emit_cidade', { length: 100 }),
    fornecedorId: uuid('fornecedor_id').references(() => fornecedor.id, { onDelete: 'set null' }),

    // Destinatario (você)
    destCnpj: varchar('dest_cnpj', { length: 14 }),
    destNome: varchar('dest_nome', { length: 200 }),

    // Datas
    dataEmissao: timestamp('data_emissao', { withTimezone: true }),
    dataEntrada: timestamp('data_entrada', { withTimezone: true }),

    // Totais
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }),
    valorProdutos: numeric('valor_produtos', { precision: 14, scale: 2 }),
    valorFrete: numeric('valor_frete', { precision: 14, scale: 2 }),
    valorSeguro: numeric('valor_seguro', { precision: 14, scale: 2 }),
    valorDesconto: numeric('valor_desconto', { precision: 14, scale: 2 }),
    valorOutros: numeric('valor_outros', { precision: 14, scale: 2 }),
    valorIcms: numeric('valor_icms', { precision: 14, scale: 2 }),
    valorIcmsSt: numeric('valor_icms_st', { precision: 14, scale: 2 }),
    valorIpi: numeric('valor_ipi', { precision: 14, scale: 2 }),
    valorPis: numeric('valor_pis', { precision: 14, scale: 2 }),
    valorCofins: numeric('valor_cofins', { precision: 14, scale: 2 }),

    // Situação / protocolo
    situacao: varchar('situacao', { length: 30 }), // 'AUTORIZADA', 'CANCELADA', 'DENEGADA'
    protocoloAutorizacao: varchar('protocolo_autorizacao', { length: 50 }),
    dataAutorizacao: timestamp('data_autorizacao', { withTimezone: true }),

    // XML
    xmlStoragePath: text('xml_storage_path'),
    xmlHash: varchar('xml_hash', { length: 64 }),

    // Metadata
    origemImportacao: varchar('origem_importacao', { length: 20 }).default('UPLOAD'), // UPLOAD | SEFAZ_MANIFESTO
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqChave: unique('uq_nota_compra_chave').on(t.filialId, t.chave),
    emissaoIdx: index('idx_nota_compra_emissao').on(t.filialId, t.dataEmissao),
    fornecedorIdx: index('idx_nota_compra_fornecedor').on(t.filialId, t.fornecedorId),
  }),
);

/** Itens da NF-e de entrada. */
export const notaCompraItem = pgTable(
  'nota_compra_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    notaCompraId: uuid('nota_compra_id')
      .notNull()
      .references(() => notaCompra.id, { onDelete: 'cascade' }),
    numeroItem: integer('numero_item').notNull(),

    // Produto
    codigoProdutoFornecedor: varchar('codigo_produto_fornecedor', { length: 60 }),
    ean: varchar('ean', { length: 20 }),
    descricao: text('descricao'),
    ncm: varchar('ncm', { length: 10 }),
    cest: varchar('cest', { length: 10 }),
    cfop: varchar('cfop', { length: 10 }),
    unidade: varchar('unidade', { length: 10 }),

    // Quantidades e valores
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }),
    valorUnitario: numeric('valor_unitario', { precision: 14, scale: 6 }),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }),
    valorDesconto: numeric('valor_desconto', { precision: 14, scale: 2 }),
    valorFrete: numeric('valor_frete', { precision: 14, scale: 2 }),

    // Impostos
    valorIcms: numeric('valor_icms', { precision: 14, scale: 2 }),
    aliquotaIcms: numeric('aliquota_icms', { precision: 8, scale: 4 }),
    valorIpi: numeric('valor_ipi', { precision: 14, scale: 2 }),
    valorPis: numeric('valor_pis', { precision: 14, scale: 2 }),
    valorCofins: numeric('valor_cofins', { precision: 14, scale: 2 }),

    // Matching com produto local
    produtoId: uuid('produto_id').references(() => produto.id, { onDelete: 'set null' }),
  },
  (t) => ({
    notaIdx: index('idx_nota_compra_item_nota').on(t.notaCompraId),
    produtoIdx: index('idx_nota_compra_item_produto').on(t.filialId, t.produtoId),
    eanIdx: index('idx_nota_compra_item_ean').on(t.filialId, t.ean),
  }),
);
