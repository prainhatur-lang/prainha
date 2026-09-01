// VENDEDOR — a pessoa com quem a casa fala. É dela o WhatsApp, não da empresa.
//
// Por que não guardar o telefone no fornecedor:
//   · o mesmo vendedor atende VÁRIOS fornecedores (o Consumer duplica a mesma
//     empresa dezenas de vezes, e um representante atende várias marcas);
//   · o mesmo fornecedor tem VÁRIOS vendedores (a Megga tem um de alimentos e
//     outro de bebidas, com números e pedidos diferentes);
//   · `fornecedor.fone_principal` vem do Consumer e é sobrescrito a cada sync,
//     quase sempre pelo FIXO da empresa — onde WhatsApp não chega.
// O vendedor é do GRUPO, não da filial: o mesmo Alex atende as três lojas.

import { pgTable, uuid, varchar, text, boolean, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizacao } from './tenant';
import { fornecedor } from './financeiro';

export const vendedor = pgTable(
  'vendedor',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizacaoId: uuid('organizacao_id')
      .notNull()
      .references(() => organizacao.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 120 }).notNull(),
    /** Só dígitos, com DDI: 5579999871286. */
    whatsapp: varchar('whatsapp', { length: 20 }),
    email: varchar('email', { length: 200 }),
    /** "vende bebidas", "atende só de manhã" — o que ajuda a escolher. */
    observacao: text('observacao'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    zapIdx: index('idx_vendedor_whatsapp').on(t.organizacaoId, t.whatsapp),
  }),
);

export const vendedorFornecedor = pgTable(
  'vendedor_fornecedor',
  {
    vendedorId: uuid('vendedor_id')
      .notNull()
      .references(() => vendedor.id, { onDelete: 'cascade' }),
    fornecedorId: uuid('fornecedor_id')
      .notNull()
      .references(() => fornecedor.id, { onDelete: 'cascade' }),
    /** Quem recebe cotação/pedido quando o fornecedor tem mais de um. */
    principal: boolean('principal').notNull().default(false),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.vendedorId, t.fornecedorId] }),
    fornIdx: index('idx_vend_forn_fornecedor').on(t.fornecedorId),
  }),
);
