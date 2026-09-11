// Pedidos de conciliação SOB DEMANDA do iFood (módulo Financeiro).
//
// O iFood gera o arquivo de conciliação do mês na hora (dados até D-1), mas
// aceita UM pedido por loja+competência a cada 6 h e devolve 409 se a gente
// pedir de novo. O `request_id` vale 24 h. Sem guardar o pedido, recarregar a
// tela ou trocar de aparelho perderia o id — e o 409 impediria pedir outro.
//
// O link do arquivo NÃO se guarda: é pré-assinado e expira. Cada leitura
// consulta o status e recebe um link novo.

import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, text, index } from 'drizzle-orm/pg-core';
import { filial } from './tenant';

export const ifoodConciliacaoPedido = pgTable(
  'ifood_conciliacao_pedido',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    merchantId: varchar('merchant_id', { length: 80 }).notNull(),
    /** yyyy-mm */
    competencia: varchar('competencia', { length: 7 }).notNull(),
    requestId: varchar('request_id', { length: 80 }).notNull(),
    /** Texto do iFood: created, enqueue, processed, error… */
    status: varchar('status', { length: 30 }).notNull().default('created'),
    /** processando | pronto | erro | expirado */
    fase: varchar('fase', { length: 20 }).notNull().default('processando'),
    erro: text('erro'),
    pedidoPor: uuid('pedido_por'),
    pedidoEm: timestamp('pedido_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
    prontoEm: timestamp('pronto_em', { withTimezone: true }),
  },
  (t) => ({
    porCompetencia: index('ifood_conciliacao_pedido_filial_comp_idx').on(t.filialId, t.competencia, t.pedidoEm),
  }),
);
