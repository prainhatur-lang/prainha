// Comprovantes da LOTÉRICA (/folha-equipe/comprovantes): o 10% da equipe sai
// das folhas semanais como conta a pagar (origem FOLHA); a lotérica deposita
// pessoa por pessoa e devolve uma foto do comprovante de cada depósito. Cada
// foto entra aqui, é lida (nome, valor, data, autenticação), casada com a(s)
// conta(s) FOLHA em aberto da pessoa e, no clique, dá a baixa.
//
// A foto fica no bucket privado `extratos-fechamento`, pasta `loterica/`.

import { pgTable, uuid, varchar, timestamp, integer, text, numeric, date, index, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial, usuario } from './tenant';

export const comprovanteLoterica = pgTable(
  'comprovante_loterica',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Casa da(s) conta(s) casada(s). Nulo enquanto não casou. */
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'set null' }),
    folhaSemanaId: uuid('folha_semana_id'),
    fornecedorId: uuid('fornecedor_id'),
    /** Conta(s) a pagar que o depósito paga: uma, ou todas as abertas da
     *  pessoa na mesma folha (comissão + gratificação num depósito só). */
    contaPagarIds: jsonb('conta_pagar_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Lidos da foto. */
    nomeLido: text('nome_lido'),
    valor: numeric('valor', { precision: 14, scale: 2 }),
    dataPagamento: date('data_pagamento'),
    hora: varchar('hora', { length: 8 }),
    autenticacao: varchar('autenticacao', { length: 60 }),
    lido: jsonb('lido'),
    /** ERRO (não leu) | SEM_CONTA (leu, não achou conta) | DUPLICADO (mesma
     *  autenticação já enviada) | CASADO (achou, falta baixar) | BAIXADO */
    status: varchar('status', { length: 12 }).notNull().default('ERRO'),
    erro: text('erro'),
    nomeOriginal: text('nome_original').notNull(),
    storagePath: text('storage_path').notNull().unique(),
    contentType: varchar('content_type', { length: 120 }),
    tamanhoBytes: integer('tamanho_bytes'),
    enviadoPor: uuid('enviado_por').references(() => usuario.id),
    enviadoEm: timestamp('enviado_em', { withTimezone: true }).notNull().defaultNow(),
    baixadoEm: timestamp('baixado_em', { withTimezone: true }),
    baixadoPor: uuid('baixado_por').references(() => usuario.id),
    /** Tirado da lista (foto errada). O arquivo continua no bucket. */
    excluidoEm: timestamp('excluido_em', { withTimezone: true }),
    excluidoPor: uuid('excluido_por').references(() => usuario.id),
  },
  (t) => ({
    filialDataIdx: index('idx_comprovante_loterica_filial_data').on(t.filialId, t.dataPagamento),
    autenticacaoIdx: index('idx_comprovante_loterica_autenticacao').on(t.autenticacao),
  }),
);
