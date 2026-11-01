// Formação de preço de revenda — Lelis Distribuidora (01/11/2026).
// A Lelis é empresa própria (não é o Prainha): compra mercadoria e VENDE pra
// outras lojas com NF-e de venda (CFOP 5102/6102).
//
// Preço = custo de entrada ÷ (1 − % operacional − % margem − % impostos da venda).
// Custo de entrada = valor unitário + IPI + carga efetiva do Decreto 40.949
// (atacadista: 10,56% de origem 4%, 6,34% de 7%, 3,17% de 12% ou interna) + frete.
// Conta em apps/web/src/lib/lelis/preco.ts.

import { pgTable, uuid, varchar, timestamp, text, date, numeric, boolean, jsonb, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const revendaProduto = pgTable(
  'revenda_produto',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** Chave do item: EAN válido, senão "F<cnpj fornecedor>:<código dele>", senão "M:<uuid>" (manual). */
    chave: varchar('chave', { length: 80 }).notNull(),
    ean: varchar('ean', { length: 14 }),
    codigoFornecedor: varchar('codigo_fornecedor', { length: 60 }),
    fornecedorNome: text('fornecedor_nome'),
    descricao: text('descricao').notNull(),
    ncm: varchar('ncm', { length: 8 }),
    cest: varchar('cest', { length: 7 }),
    unidade: varchar('unidade', { length: 6 }).notNull().default('UN'),
    /** Valor unitário da nota de compra (com desconto já abatido). */
    custoUnit: numeric('custo_unit', { precision: 14, scale: 4 }).notNull().default('0'),
    pctIpi: numeric('pct_ipi', { precision: 7, scale: 4 }).notNull().default('0'),
    /** Alíquota interestadual de origem (4, 7, 12) ou interna (17+): define a carga do Decreto 40.949. */
    aliqOrigem: numeric('aliq_origem', { precision: 5, scale: 2 }),
    /** Carga efetiva digitada à mão (null = sai da alíquota de origem). */
    pctCarga: numeric('pct_carga', { precision: 7, scale: 4 }),
    /** A carga incide sobre valor + IPI (padrão) ou só sobre o valor. */
    cargaComIpi: boolean('carga_com_ipi').notNull().default(true),
    freteUnit: numeric('frete_unit', { precision: 14, scale: 4 }).notNull().default('0'),
    /** null = usa o padrão de revenda_config. */
    pctOperacional: numeric('pct_operacional', { precision: 7, scale: 4 }),
    pctMargem: numeric('pct_margem', { precision: 7, scale: 4 }),
    pctImpostosVenda: numeric('pct_impostos_venda', { precision: 7, scale: 4 }),
    /** Preço fechado à mão (vence o calculado). */
    precoManual: numeric('preco_manual', { precision: 14, scale: 2 }),
    // Tributação da SAÍDA (01/11/2026): tirada da nota de entrada (lib/lelis/tributacao.ts).
    /** TRIBUTADO | ST | ISENTO | NAO_TRIB (null = config geral). */
    tribIcms: varchar('trib_icms', { length: 10 }),
    /** CST de PIS/COFINS na venda: 01 tributado, 04 monofásico, 05 ST, 06 alíq. zero, 07 isento, 09 suspensão. */
    cstPisSaida: varchar('cst_pis_saida', { length: 2 }),
    /** Tributação escolhida à mão: a nota nova não troca. */
    tribManual: boolean('trib_manual').notNull().default(false),
    /** Como veio na última entrada (pra conferir). */
    cfopEntrada: varchar('cfop_entrada', { length: 4 }),
    cstIcmsEntrada: varchar('cst_icms_entrada', { length: 4 }),
    cstPisEntrada: varchar('cst_pis_entrada', { length: 2 }),
    /** ICMS-ST pago na entrada por unidade (destacado ou retido). */
    icmsStUnit: numeric('icms_st_unit', { precision: 14, scale: 4 }),
    ultimaNotaChave: varchar('ultima_nota_chave', { length: 44 }),
    ultimaCompraEm: date('ultima_compra_em'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoPor: text('atualizado_por'),
  },
  (t) => ({
    uq: unique('uq_revenda_produto_chave').on(t.filialId, t.chave),
    idxFilial: index('idx_revenda_produto_filial').on(t.filialId, t.ativo),
  }),
);

export interface RevendaFiscal {
  /** CST do ICMS na venda (regime normal): '00' destaca, '40'/'41' isento/não trib., '60' ST já retida. */
  cstIcms?: string;
  aliqIcms?: number;
  /** CSOSN quando a empresa é do Simples (102, 500…). */
  csosn?: string;
  cstPis?: string;
  aliqPis?: number;
  cstCofins?: string;
  aliqCofins?: number;
  /** Texto fixo em informações complementares (ex.: número do Termo de Acordo). */
  infCpl?: string;
}

export const revendaConfig = pgTable('revenda_config', {
  filialId: uuid('filial_id').primaryKey().references(() => filial.id, { onDelete: 'cascade' }),
  pctOperacional: numeric('pct_operacional', { precision: 7, scale: 4 }).notNull().default('10'),
  pctMargem: numeric('pct_margem', { precision: 7, scale: 4 }).notNull().default('15'),
  pctImpostosVenda: numeric('pct_impostos_venda', { precision: 7, scale: 4 }).notNull().default('0'),
  fiscal: jsonb('fiscal').$type<RevendaFiscal>().notNull().default(sql`'{}'::jsonb`),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoPor: text('atualizado_por'),
});

/**
 * Estoque da Lelis (01/11/2026): saldo = soma das quantidades (entrada +, saída −).
 * ENTRADA_COMPRA vem de "Dar entrada" na nota de compra (1 linha por item da nota,
 * única); SAIDA_VENDA quando a NF-e de venda é autorizada; ESTORNO_VENDA no cancelamento.
 */
export const revendaMovimento = pgTable(
  'revenda_movimento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    revendaProdutoId: uuid('revenda_produto_id').notNull().references(() => revendaProduto.id, { onDelete: 'cascade' }),
    /** ENTRADA_COMPRA | SAIDA_VENDA | ESTORNO_VENDA | AJUSTE */
    tipo: varchar('tipo', { length: 16 }).notNull(),
    /** Com sinal: entrada positiva, saída negativa. */
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }).notNull(),
    custoUnit: numeric('custo_unit', { precision: 14, scale: 4 }),
    notaCompraItemId: uuid('nota_compra_item_id'),
    nfeEmitidaId: uuid('nfe_emitida_id'),
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    criadoPor: text('criado_por'),
  },
  (t) => ({
    idxProd: index('idx_revenda_mov_prod').on(t.filialId, t.revendaProdutoId),
  }),
);

/** Contas a receber da Lelis (01/11/2026): uma linha por parcela da NF-e de venda. */
export const revendaReceber = pgTable(
  'revenda_receber',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    nfeEmitidaId: uuid('nfe_emitida_id'),
    compradorDoc: varchar('comprador_doc', { length: 14 }),
    compradorNome: text('comprador_nome'),
    descricao: text('descricao'),
    parcela: numeric('parcela', { precision: 4, scale: 0 }).notNull().default('1'),
    totalParcelas: numeric('total_parcelas', { precision: 4, scale: 0 }).notNull().default('1'),
    vencimento: date('vencimento').notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    formaPagamento: varchar('forma_pagamento', { length: 2 }),
    recebidoEm: date('recebido_em'),
    valorRecebido: numeric('valor_recebido', { precision: 14, scale: 2 }),
    recebidoPor: text('recebido_por'),
    cancelado: boolean('cancelado').notNull().default(false),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    criadoPor: text('criado_por'),
  },
  (t) => ({
    idxFilial: index('idx_revenda_receber_filial').on(t.filialId, t.vencimento),
  }),
);
