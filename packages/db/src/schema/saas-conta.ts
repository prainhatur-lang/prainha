// Conta de cliente do Concilia (SaaS) — 02/11/2026.
// Nasce no cadastro sozinho do site (/comecar): a pessoa informa CPF ou CNPJ e
// os contatos, e o teste de 15 dias com TODOS os módulos começa na hora. Ao fim
// do teste a mensalidade é cobrada por Pix. Um documento = uma conta (o mesmo
// CPF/CNPJ não ganha um segundo teste).
//
// organizacao_id/filial_id ficam vazios até a loja do cliente ser criada.

import { pgTable, uuid, varchar, timestamp, text, date, index, unique } from 'drizzle-orm/pg-core';

export const saasConta = pgTable(
  'saas_conta',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Só dígitos: 11 (CPF) ou 14 (CNPJ). */
    documento: varchar('documento', { length: 14 }).notNull(),
    /** 'CPF' | 'CNPJ' */
    tipoDocumento: varchar('tipo_documento', { length: 4 }).notNull(),
    /** Razão social (CNPJ) ou o nome da pessoa (CPF). */
    razaoSocial: varchar('razao_social', { length: 200 }),
    /** Nome do estabelecimento como o cliente conhece. */
    nomeFantasia: varchar('nome_fantasia', { length: 200 }).notNull(),
    responsavel: varchar('responsavel', { length: 200 }).notNull(),
    email: varchar('email', { length: 200 }).notNull(),
    whatsapp: varchar('whatsapp', { length: 20 }).notNull(),
    cidade: varchar('cidade', { length: 120 }),
    uf: varchar('uf', { length: 2 }),
    /** Plano que a pessoa marcou no site (gratis, essencial, gestao, completo, nao_sei). */
    planoDesejado: varchar('plano_desejado', { length: 30 }),
    /** teste | aguardando_pagamento | ativa | suspensa | cancelada */
    status: varchar('status', { length: 24 }).notNull().default('teste'),
    testeInicio: date('teste_inicio').notNull(),
    /** Último dia do teste (inclusive). */
    testeFim: date('teste_fim').notNull(),
    /** Lead que esta conta gerou em saas_interessado (a lista de sempre). */
    interessadoId: uuid('interessado_id'),
    organizacaoId: uuid('organizacao_id'),
    filialId: uuid('filial_id'),
    origem: varchar('origem', { length: 40 }),
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('saas_conta_documento_uq').on(t.documento), index('saas_conta_criado_idx').on(t.criadoEm)],
);
