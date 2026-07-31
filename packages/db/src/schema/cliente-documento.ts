// Cadastro de cliente COMPARTILHADO entre as filiais do grupo.
//
// Cada loja tem seu Consumer e seu Postgres local — quem e' cliente da
// Prainha Bar nao existe pro Tabuara. Esta tabela e' a base unica: o cliente
// se identifica uma vez e e' reconhecido em qualquer casa do grupo.
//
// Guarda o HASH do CPF, nao o CPF. Serve pro que a operacao precisa (achar o
// nome de quem chega) sem virar um deposito de documento: se vazar, nao da
// pra extrair os CPFs. O Consumer segue guardando o CPF em claro pra NFC-e —
// isso aqui nao substitui, complementa.

import { pgTable, uuid, text, timestamp, varchar, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizacao, filial } from './tenant';

export const clienteDocumento = pgTable(
  'cliente_documento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Compartilhado no grupo todo, nao por filial. */
    organizacaoId: uuid('organizacao_id')
      .notNull()
      .references(() => organizacao.id, { onDelete: 'cascade' }),
    /** sha256(salt::cpf) — o CPF em claro nunca chega aqui. */
    cpfHash: varchar('cpf_hash', { length: 64 }).notNull(),
    /** Ultimos 8 digitos do telefone, a chave alternativa de quem nao da CPF. */
    telefoneFim: varchar('telefone_fim', { length: 8 }),
    nome: text('nome').notNull(),
    /** consumer | spc | manual | importacao — de onde veio o nome. */
    origem: varchar('origem', { length: 20 }).notNull().default('manual'),
    /** Onde foi visto pela primeira vez. */
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'set null' }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCpfIdx: index('cliente_documento_org_cpf_idx').on(t.organizacaoId, t.cpfHash),
    orgTelIdx: index('cliente_documento_org_tel_idx').on(t.organizacaoId, t.telefoneFim),
  }),
);
