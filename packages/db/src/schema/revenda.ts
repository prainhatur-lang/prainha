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
