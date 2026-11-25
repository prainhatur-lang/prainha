// Link de pagamento avulso por CARTÃO (dono 25/11/2026: "preciso de um link
// para pagamento por cartão para somente 1 vez com segurança 3ds para evitar
// fraude"). A casa informa valor e a que se refere; sai um link
// /cobranca/<token> que o cliente abre e paga no cartão.
//
// Duas travas que definem a tabela:
//  - USO ÚNICO: pagou, o link morre (status 'pago'). A cobrança "pega" o link
//    (aberto → processando) num UPDATE atômico, então dois cliques ou duas
//    abas nunca cobram duas vezes.
//  - 3DS OBRIGATÓRIO: sem autenticação do banco emissor (Cavv + ECI de
//    autenticado) a cobrança nem é enviada, em qualquer valor. O ECI fica
//    gravado: em disputa, é a prova de que a casa tinha a proteção.

import { pgTable, uuid, text, timestamp, varchar, integer, serial, numeric, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const linkPagamento = pgTable(
  'link_pagamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    numero: serial('numero'),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Reserva que originou o link (gerente gera pela tela de reservas). Sem FK:
     *  reserva excluída não apaga o registro do pagamento. */
    reservaId: uuid('reserva_id'),
    /** Orçamento de evento a que o link pertence. Pago, entra como recebido no
     *  evento (saldo = total − entrada − links pagos). Sem FK, como a reserva. */
    orcamentoId: uuid('orcamento_id'),
    /** Vai na URL — é a "senha" do link. */
    token: text('token').notNull().unique(),
    descricao: varchar('descricao', { length: 300 }).notNull(),
    clienteNome: varchar('cliente_nome', { length: 200 }),
    clienteTelefone: varchar('cliente_telefone', { length: 30 }),
    valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
    /** aberto | processando | pago | cancelado | verificar
     *  verificar = a Cielo não respondeu (queda de rede no meio da cobrança):
     *  o link trava até alguém conferir se cobrou ou não. */
    status: varchar('status', { length: 20 }).notNull().default('aberto'),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    /** Quantas vezes tentaram cobrar (recusas contam) — trava teste de cartão. */
    tentativas: integer('tentativas').notNull().default(0),
    processandoEm: timestamp('processando_em', { withTimezone: true }),
    paymentId: varchar('payment_id', { length: 60 }),
    /** CreditCard | DebitCard */
    tipoPagamento: varchar('tipo_pagamento', { length: 20 }),
    bandeira: varchar('bandeira', { length: 30 }),
    /** ECI devolvido pelo 3DS na cobrança aprovada. */
    eci: varchar('eci', { length: 4 }),
    /** Últimos 4 dígitos do cartão que pagou. */
    cartaoFinal: varchar('cartao_final', { length: 4 }),
    erro: text('erro'),
    pagoEm: timestamp('pago_em', { withTimezone: true }),
    criadoPor: varchar('criado_por', { length: 160 }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoPor: varchar('cancelado_por', { length: 160 }),
  },
  (t) => [
    index('link_pagamento_filial_criado_idx').on(t.filialId, t.criadoEm),
    index('link_pagamento_reserva_idx').on(t.reservaId),
    index('link_pagamento_orcamento_idx').on(t.orcamentoId),
  ],
);
