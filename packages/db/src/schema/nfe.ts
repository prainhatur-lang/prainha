// NF-e (modelo 55) EMITIDA pelo Concilia — hoje só a nota de TRANSFERÊNCIA
// entre casas da mesma empresa (Bar → Mar etc.). Mesmo transporte da NFC-e
// (nfce.ts): assina com o A1 da filial e transmite pra SVRS.
//
// É opcional: a transferência vale sozinha (só financeiro); a nota fiscal é
// pedida depois, se quiser. 1 nota "viva" por transferência e ambiente —
// retry reusa a MESMA linha (mesmo número/chave).

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { transferenciaFilial } from './transferencia';

/** Item da nota (snapshot do que foi pro XML). */
export interface NfeItemSnapshot {
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  ncm: string;
  cfop: string;
  csosn: string;
}

export const nfeEmitida = pgTable(
  'nfe_emitida',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Casa que EMITE (a que envia a mercadoria) */
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** 1 = produção, 2 = homologação. */
    ambiente: integer('ambiente').notNull(),
    serie: integer('serie').notNull(),
    numero: integer('numero').notNull(),
    chave: varchar('chave', { length: 44 }).notNull(),
    cnf: varchar('cnf', { length: 8 }).notNull(),
    /** PENDENTE | AUTORIZADA | REJEITADA | ERRO | CANCELADA */
    status: varchar('status', { length: 20 }).notNull().default('PENDENTE'),
    cstat: varchar('cstat', { length: 8 }),
    xmotivo: text('xmotivo'),
    protocolo: varchar('protocolo', { length: 20 }),
    autorizadaEm: timestamp('autorizada_em', { withTimezone: true }),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    protocoloCancelamento: varchar('protocolo_cancelamento', { length: 20 }),
    justificativaCancelamento: text('justificativa_cancelamento'),
    transferenciaId: uuid('transferencia_id').references(() => transferenciaFilial.id, {
      onDelete: 'set null',
    }),
    /** Casa destinatária */
    filialDestinoId: uuid('filial_destino_id').references(() => filial.id, { onDelete: 'set null' }),
    destCnpj: varchar('dest_cnpj', { length: 14 }),
    naturezaOperacao: varchar('natureza_operacao', { length: 60 }).notNull(),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull(),
    itens: jsonb('itens').$type<NfeItemSnapshot[]>().notNull(),
    infoExtra: text('info_extra'),
    /** NFe assinada enquanto pendente; nfeProc completo depois de autorizar. */
    xml: text('xml'),
    erro: text('erro'),
    solicitadoPor: uuid('solicitado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chaveUq: uniqueIndex('nfe_chave_uq').on(t.chave),
    filialNumeroUq: uniqueIndex('nfe_filial_serie_numero_uq').on(t.filialId, t.ambiente, t.serie, t.numero),
    /** 1 nota "viva" por transferência e ambiente — cancelada libera nova. */
    transfVivaUq: uniqueIndex('nfe_transf_viva_uq')
      .on(t.transferenciaId, t.ambiente)
      .where(sql`status IN ('PENDENTE', 'AUTORIZADA') AND transferencia_id IS NOT NULL`),
    transfIdx: index('nfe_transf_idx').on(t.transferenciaId),
    filialIdx: index('nfe_filial_idx').on(t.filialId, t.criadoEm),
  }),
);

/** Numeração por (filial, série, ambiente) — igual à da NFC-e, mas do modelo 55. */
export const nfeNumeracao = pgTable(
  'nfe_numeracao',
  {
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    serie: integer('serie').notNull(),
    ambiente: integer('ambiente').notNull(),
    ultimoNumero: integer('ultimo_numero').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.filialId, t.serie, t.ambiente] }),
  }),
);
