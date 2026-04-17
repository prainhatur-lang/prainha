// Tracking de arquivos importados (Cielo Vendas, Recebiveis, CNAB Inter, etc.)
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  jsonb,
  text,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial, usuario } from './tenant';

export const arquivoImportacao = pgTable(
  'arquivo_importacao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Tipo do arquivo: CIELO_VENDAS | CIELO_RECEBIVEIS | CNAB240_INTER */
    tipo: varchar('tipo', { length: 30 }).notNull(),
    nomeOriginal: text('nome_original').notNull(),
    /** Caminho no Supabase Storage (bucket arquivos-importacao) */
    storagePath: text('storage_path').notNull(),
    tamanhoBytes: bigint('tamanho_bytes', { mode: 'number' }),
    /** PENDENTE | PROCESSANDO | OK | ERRO */
    status: varchar('status', { length: 20 }).notNull().default('PENDENTE'),
    /** Numero de linhas processadas com sucesso */
    registrosProcessados: bigint('registros_processados', { mode: 'number' }).default(0),
    /** Resumo do processamento (ex: range de datas, totais) */
    resumo: jsonb('resumo').$type<Record<string, unknown>>(),
    erro: text('erro'),
    enviadoPor: uuid('enviado_por').references(() => usuario.id, { onDelete: 'set null' }),
    enviadoEm: timestamp('enviado_em', { withTimezone: true }).notNull().defaultNow(),
    processadoEm: timestamp('processado_em', { withTimezone: true }),
  },
  (t) => ({
    filialIdx: index('arquivo_filial_idx').on(t.filialId, t.enviadoEm),
    statusIdx: index('arquivo_status_idx').on(t.status),
  }),
);
