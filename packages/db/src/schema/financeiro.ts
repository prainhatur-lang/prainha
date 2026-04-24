import { pgTable, uuid, text, timestamp, varchar, integer, date, numeric, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/** Plano de contas (espelha CATEGORIACONTAS do Consumer).
 *  Hierarquico via codigo_pai_externo.  */
export const categoriaConta = pgTable(
  'categoria_conta',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoPaiExterno: integer('codigo_pai_externo'),
    codigoGrupoDreExterno: integer('codigo_grupo_dre_externo'),
    descricao: varchar('descricao', { length: 200 }),
    /** RECEITA | DESPESA (derivado do TIPO do Consumer) */
    tipo: varchar('tipo', { length: 20 }),
    excluidaEm: timestamp('excluida_em', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_cat_conta_filial_codigo').on(t.filialId, t.codigoExterno),
  }),
);

/** Fornecedor (espelha FORNECEDORES). */
export const fornecedor = pgTable(
  'fornecedor',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    cnpjOuCpf: varchar('cnpj_ou_cpf', { length: 14 }),
    nome: varchar('nome', { length: 200 }),
    razaoSocial: varchar('razao_social', { length: 200 }),
    endereco: text('endereco'),
    numero: varchar('numero', { length: 20 }),
    complemento: varchar('complemento', { length: 100 }),
    bairro: varchar('bairro', { length: 100 }),
    cidade: varchar('cidade', { length: 100 }),
    uf: varchar('uf', { length: 2 }),
    cep: varchar('cep', { length: 10 }),
    email: varchar('email', { length: 200 }),
    fonePrincipal: varchar('fone_principal', { length: 30 }),
    foneSecundario: varchar('fone_secundario', { length: 30 }),
    rgOuIe: varchar('rg_ou_ie', { length: 30 }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_fornecedor_filial_codigo').on(t.filialId, t.codigoExterno),
    cnpjIdx: index('idx_fornecedor_cnpj').on(t.filialId, t.cnpjOuCpf),
  }),
);

/** Conta bancaria (espelha CONTASBANCARIAS). */
export const contaBancariaConsumer = pgTable(
  'conta_bancaria_consumer',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    descricao: varchar('descricao', { length: 200 }),
    banco: varchar('banco', { length: 100 }),
    agencia: varchar('agencia', { length: 20 }),
    conta: varchar('conta', { length: 30 }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_conta_bancaria_filial_codigo').on(t.filialId, t.codigoExterno),
  }),
);

/** Conta a pagar (espelha CONTASPAGAR). */
export const contaPagar = pgTable(
  'conta_pagar',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoFornecedorExterno: integer('codigo_fornecedor_externo'),
    codigoCategoriaExterno: integer('codigo_categoria_externo'),
    codigoContaBancariaExterno: integer('codigo_conta_bancaria_externo'),
    /** FK resolvida (pode ser null se fornecedor nao veio ainda) */
    fornecedorId: uuid('fornecedor_id').references(() => fornecedor.id, { onDelete: 'set null' }),
    categoriaId: uuid('categoria_id').references(() => categoriaConta.id, { onDelete: 'set null' }),
    parcela: integer('parcela'),
    totalParcelas: integer('total_parcelas'),
    dataVencimento: date('data_vencimento').notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    dataPagamento: date('data_pagamento'),
    descontos: numeric('descontos', { precision: 14, scale: 2 }),
    jurosMulta: numeric('juros_multa', { precision: 14, scale: 2 }),
    valorPago: numeric('valor_pago', { precision: 14, scale: 2 }),
    codigoReferencia: varchar('codigo_referencia', { length: 50 }),
    /** competencia YYYY-MM (ex: '2026-04') */
    competencia: varchar('competencia', { length: 7 }),
    descricao: text('descricao'),
    observacao: text('observacao'),
    dataCadastro: timestamp('data_cadastro', { withTimezone: true }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_conta_pagar_filial_codigo').on(t.filialId, t.codigoExterno),
    vencIdx: index('idx_conta_pagar_venc').on(t.filialId, t.dataVencimento),
    pagamentoIdx: index('idx_conta_pagar_pgto').on(t.filialId, t.dataPagamento),
  }),
);
