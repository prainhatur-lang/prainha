// Variantes de produto, tamanhos, ficha tecnica e complementos (espelho de
// PRODUTODETALHE / PRODUTOTAMANHO / PRODUTOFICHA / PRODUTODETALHECOMPLEMENTO
// do Firebird), alem de lookups PRODUTOTIPO, PRODUTOSTAMANHOS e UNIDADECOMERCIALIZACAO.

import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  smallint,
  timestamp,
  boolean,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { produto } from './vendas';

// --------- Lookups globais (mesmos em todas as filiais) ---------

/** PRODUTOTIPO do Consumer (6 valores: Produto/Insumo/Complemento/Combo/...). */
export const produtoTipo = pgTable('produto_tipo', {
  codigo: integer('codigo').primaryKey(), // mesmo codigo do Consumer
  descricao: varchar('descricao', { length: 50 }).notNull(),
});

/** UNIDADECOMERCIALIZACAO do Consumer (g, kg, ml, L, etc). */
export const unidadeComercializacao = pgTable('unidade_comercializacao', {
  codigo: integer('codigo').primaryKey(),
  sigla: varchar('sigla', { length: 10 }).notNull(),
  descricao: varchar('descricao', { length: 50 }).notNull(),
});

/** PRODUTOSTAMANHOS — lookup F/P/M/G/T (5 valores). */
export const produtoTamanhoLookup = pgTable('produto_tamanho_lookup', {
  codigo: integer('codigo').primaryKey(),
  sigla: varchar('sigla', { length: 5 }).notNull(),
  descricao: varchar('descricao', { length: 50 }).notNull(),
});

// --------- Tamanho por produto (PRODUTOTAMANHO) ---------

/** Configuracao de tamanho/parts pra um produto especifico. QTDMAXIMAPARTES > 1
 *  = meio-a-meio (pizza com 2 sabores). */
export const produtoTamanho = pgTable(
  'produto_tamanho',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoProdutoPersonalizado: integer('codigo_produto_personalizado'),
    qtdMaximaPartes: integer('qtd_maxima_partes'),
    descricao: varchar('descricao', { length: 80 }),
    sigla: varchar('sigla', { length: 10 }),
    codigoGuid: varchar('codigo_guid', { length: 36 }),
    dataInsert: timestamp('data_insert', { withTimezone: true }),
    dataUpdate: timestamp('data_update', { withTimezone: true }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_produtotamanho_filial_codigo').on(t.filialId, t.codigoExterno),
  }),
);

// --------- Variantes (PRODUTODETALHE) ---------

/** Variante de produto: PDV vende variantes, nao o produto pai. Cada variante
 *  tem PRECO/ESTOQUE/CODIGOBARRA proprio. */
export const produtoVariante = pgTable(
  'produto_variante',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoProdutoExterno: integer('codigo_produto_externo').notNull(),
    produtoId: uuid('produto_id').references(() => produto.id, { onDelete: 'cascade' }),
    codigoProdutoTamanhoExterno: integer('codigo_produto_tamanho_externo'),
    produtoTamanhoId: uuid('produto_tamanho_id').references(() => produtoTamanho.id, { onDelete: 'set null' }),
    precoCusto: numeric('preco_custo', { precision: 14, scale: 4 }),
    precoVenda: numeric('preco_venda', { precision: 14, scale: 4 }),
    estoqueAtual: numeric('estoque_atual', { precision: 14, scale: 3 }),
    estoqueMinimo: numeric('estoque_minimo', { precision: 14, scale: 3 }),
    estoqueControlado: boolean('estoque_controlado'),
    codigoBarra: varchar('codigo_barra', { length: 30 }),
    codigoGuid: varchar('codigo_guid', { length: 36 }),
    /** Flags de canal de venda */
    desktop: boolean('desktop'),
    comandaMobile: boolean('comanda_mobile'),
    cardapioDigital: boolean('cardapio_digital'),
    menuDino: boolean('menu_dino'),
    totem: boolean('totem'),
    dataPausado: timestamp('data_pausado', { withTimezone: true }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_produtovariante_filial_codigo').on(t.filialId, t.codigoExterno),
    produtoIdx: index('idx_produtovariante_produto').on(t.filialId, t.codigoProdutoExterno),
    eanIdx: index('idx_produtovariante_ean').on(t.filialId, t.codigoBarra),
  }),
);

// --------- Ficha tecnica por variante (PRODUTOFICHA) ---------

/** Receita: variante composta -> variante ingrediente + qtd. */
export const produtoVarianteFicha = pgTable(
  'produto_variante_ficha',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    /** PRODUTOFICHA.CODIGOPRODUTODETALHE — variante "pai" (composta) */
    codigoVarianteExterno: integer('codigo_variante_externo').notNull(),
    varianteId: uuid('variante_id').references(() => produtoVariante.id, { onDelete: 'cascade' }),
    /** PRODUTOFICHA.CODIGOPRODUTODETALHEITEM — variante "filho" (ingrediente) */
    codigoIngredienteExterno: integer('codigo_ingrediente_externo').notNull(),
    ingredienteId: uuid('ingrediente_id').references(() => produtoVariante.id, { onDelete: 'restrict' }),
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }),
    precoPromo: numeric('preco_promo', { precision: 14, scale: 4 }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_pvf_filial_codigo').on(t.filialId, t.codigoExterno),
    varianteIdx: index('idx_pvf_variante').on(t.filialId, t.codigoVarianteExterno),
  }),
);

// --------- Complementos (PRODUTODETALHECOMPLEMENTO) ---------

/** Relacao: variante X pode ter variante Y como complemento (bacon extra, queijo). */
export const produtoVarianteComplemento = pgTable(
  'produto_variante_complemento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoVarianteExterno: integer('codigo_variante_externo').notNull(),
    varianteId: uuid('variante_id').references(() => produtoVariante.id, { onDelete: 'cascade' }),
    codigoComplementoExterno: integer('codigo_complemento_externo').notNull(),
    complementoId: uuid('complemento_id').references(() => produtoVariante.id, { onDelete: 'restrict' }),
    codigoGuid: varchar('codigo_guid', { length: 36 }),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_pvc_filial_codigo').on(t.filialId, t.codigoExterno),
    varianteIdx: index('idx_pvc_variante').on(t.filialId, t.codigoVarianteExterno),
  }),
);

/** ETIQUETAS do Consumer — a categoria REAL do cardápio (Petiscos, Drinks,
 *  Cervejas...). Espelho por filial: o código só faz sentido dentro da loja.
 *  Sincronizada por `pnpm --filter @concilia/db sync:etiquetas` (lê o Firebird
 *  da loja pela VPN), porque o agente local ainda não traz esta tabela. */
export const produtoEtiqueta = pgTable(
  'produto_etiqueta',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    nome: varchar('nome', { length: 100 }).notNull(),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_produto_etiqueta_filial_codigo').on(t.filialId, t.codigoExterno),
  }),
);
