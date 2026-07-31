// Cobranca de conta de MESA paga pelo proprio cliente, no cartao.
//
// Por que isso existe na nuvem e nao no vendas-local: o servidor da loja roda
// em HTTP na rede interna. Capturar numero de cartao ali expoe os dados a
// qualquer um no Wi-Fi da casa e fica fora do PCI-DSS. Entao o cliente e'
// mandado pra ca (Vercel, HTTPS) e nenhum dado de cartao passa pela loja.
//
// O vendas-local nao tem login no concilia: ele monta um link ASSINADO com
// HMAC (segredo compartilhado) e depois consulta o status pelo mesmo caminho.
// Nada aqui aceita valor sem assinatura valida.

import { pgTable, uuid, text, timestamp, varchar, integer, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const cobrancaMesa = pgTable(
  'cobranca_mesa',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Referencia gerada pelo vendas-local — e' por ela que ele consulta. */
    ref: varchar('ref', { length: 64 }).notNull().unique(),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Numero da mesa ou comanda na loja. */
    mesa: integer('mesa').notNull(),
    /** Em CENTAVOS, como a Cielo trabalha — evita erro de arredondamento. */
    valorCentavos: integer('valor_centavos').notNull(),
    /** aguardando | pago | recusado | expirado */
    status: varchar('status', { length: 20 }).notNull().default('aguardando'),
    /** CreditCard | DebitCard */
    tipoPagamento: varchar('tipo_pagamento', { length: 20 }),
    paymentId: varchar('payment_id', { length: 60 }),
    autorizacao: varchar('autorizacao', { length: 60 }),
    bandeira: varchar('bandeira', { length: 30 }),
    /** Ultimo erro devolvido pela Cielo, pra mostrar ao cliente e depurar. */
    erro: text('erro'),
    /** Depois disso o link nao vale mais (o vendas-local manda no HMAC). */
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    pagoEm: timestamp('pago_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialStatusIdx: index('cobranca_mesa_filial_status_idx').on(t.filialId, t.status),
    criadoIdx: index('cobranca_mesa_criado_idx').on(t.criadoEm),
  }),
);
