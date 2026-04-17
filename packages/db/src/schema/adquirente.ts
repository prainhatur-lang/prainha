// Dados vindos dos arquivos do adquirente (Cielo, futuramente Stone/Rede)
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  numeric,
  index,
  unique,
  text,
  date,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/**
 * Cadastro de estabelecimentos do adquirente.
 * Ex: Cielo 2900246061 -> filial X.
 */
export const estabelecimentoAdquirente = pgTable(
  'estabelecimento_adquirente',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    adquirente: varchar('adquirente', { length: 30 }).notNull(),
    codigoEstabelecimento: varchar('codigo_estabelecimento', { length: 30 }).notNull(),
    apelido: varchar('apelido', { length: 100 }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueAdq: unique().on(t.adquirente, t.codigoEstabelecimento),
  }),
);

/**
 * Vendas detalhadas extraidas do arquivo "Vendas Cielo".
 * Cada linha = uma transacao identificada por NSU.
 */
export const vendaAdquirente = pgTable(
  'venda_adquirente',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    adquirente: varchar('adquirente', { length: 30 }).notNull(),
    codigoEstabelecimento: varchar('codigo_estabelecimento', { length: 30 }),
    dataVenda: date('data_venda').notNull(),
    horaVenda: varchar('hora_venda', { length: 8 }),
    formaPagamento: varchar('forma_pagamento', { length: 50 }),
    bandeira: varchar('bandeira', { length: 50 }),
    valorBruto: numeric('valor_bruto', { precision: 14, scale: 2 }).notNull(),
    valorTaxa: numeric('valor_taxa', { precision: 14, scale: 2 }),
    valorLiquido: numeric('valor_liquido', { precision: 14, scale: 2 }),
    nsu: varchar('nsu', { length: 50 }).notNull(),
    autorizacao: varchar('autorizacao', { length: 50 }),
    tid: varchar('tid', { length: 50 }),
    dataPrevistaPagamento: date('data_prevista_pagamento'),
    arquivoOrigem: text('arquivo_origem'),
    importadoEm: timestamp('importado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nsuFilialUnique: unique('venda_adq_filial_nsu_unique').on(t.filialId, t.adquirente, t.nsu),
    nsuIdx: index('venda_adq_nsu_idx').on(t.nsu),
    dataIdx: index('venda_adq_data_idx').on(t.filialId, t.dataVenda),
  }),
);

/**
 * Recebiveis (a agenda de pagamento) extraidos do arquivo "Recebiveis Cielo".
 * Cada linha = uma transacao com data prevista de credito.
 */
export const recebivelAdquirente = pgTable(
  'recebivel_adquirente',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    adquirente: varchar('adquirente', { length: 30 }).notNull(),
    codigoEstabelecimento: varchar('codigo_estabelecimento', { length: 30 }),
    dataPagamento: date('data_pagamento').notNull(),
    dataVenda: date('data_venda'),
    formaPagamento: varchar('forma_pagamento', { length: 50 }),
    bandeira: varchar('bandeira', { length: 50 }),
    valorBruto: numeric('valor_bruto', { precision: 14, scale: 2 }).notNull(),
    valorTaxa: numeric('valor_taxa', { precision: 14, scale: 2 }),
    valorLiquido: numeric('valor_liquido', { precision: 14, scale: 2 }).notNull(),
    nsu: varchar('nsu', { length: 50 }).notNull(),
    autorizacao: varchar('autorizacao', { length: 50 }),
    status: varchar('status', { length: 30 }),
    arquivoOrigem: text('arquivo_origem'),
    importadoEm: timestamp('importado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nsuFilialUnique: unique('rec_adq_filial_nsu_unique').on(t.filialId, t.adquirente, t.nsu),
    nsuIdx: index('rec_adq_nsu_idx').on(t.nsu),
    dataPagIdx: index('rec_adq_data_pag_idx').on(t.filialId, t.dataPagamento),
  }),
);
