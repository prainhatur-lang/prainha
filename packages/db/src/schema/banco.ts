// Dados vindos dos extratos bancarios (CNAB 240, OFX no futuro)
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
  char,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const contaBancaria = pgTable(
  'conta_bancaria',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    banco: varchar('banco', { length: 100 }).notNull(),
    codigoBanco: varchar('codigo_banco', { length: 5 }),
    agencia: varchar('agencia', { length: 10 }),
    conta: varchar('conta', { length: 30 }),
    apelido: varchar('apelido', { length: 100 }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueConta: unique().on(t.codigoBanco, t.agencia, t.conta),
  }),
);

export const lancamentoBanco = pgTable(
  'lancamento_banco',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    contaBancariaId: uuid('conta_bancaria_id')
      .notNull()
      .references(() => contaBancaria.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    dataMovimento: date('data_movimento').notNull(),
    dataExecucao: date('data_execucao'),
    /** C = credito, D = debito */
    tipo: char('tipo', { length: 1 }).notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    codigoHistorico: varchar('codigo_historico', { length: 20 }),
    descricao: varchar('descricao', { length: 100 }),
    idTransacao: varchar('id_transacao', { length: 50 }),
    arquivoOrigem: text('arquivo_origem'),
    importadoEm: timestamp('importado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contaDataIdx: index('lanc_banco_conta_data_idx').on(t.contaBancariaId, t.dataMovimento),
    /** Mesma transacao nao deve ser importada 2x */
    uniqueLanc: unique('lanc_banco_unique').on(
      t.contaBancariaId,
      t.dataMovimento,
      t.tipo,
      t.valor,
      t.idTransacao,
    ),
  }),
);
