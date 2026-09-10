// Puxador único do iFood NA NUVEM.
//
// A fila de eventos do polling do iFood é por CREDENCIAL (device), não por
// loja: duas máquinas puxando com o mesmo client_id dividem a fila e some
// pedido (aconteceu em ago/2026 com a Prainha Mar). Como as três casas estão
// no MESMO app homologado (Concilia PDV Central), quem puxa passa a ser a
// nuvem — uma vez só — e cada evento é roteado pra filial dona do merchant.
//
// Estas tabelas são o correio entre o puxador e as lojas:
//   ifood_nuvem_evento → a fila que cada loja consome (/api/loja/ifood-fila)
//   ifood_nuvem_pedido → o pedido já baixado (a loja não fala com o iFood)
//   ifood_nuvem_lease  → trava de consumidor único: duas invocações do cron
//                        ao mesmo tempo repetiriam o erro que a trava evita.
//
// Nada aqui é espelho do Consumer (≠ ifood_pedido, que vem do CDC do agente).

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { filial } from './tenant';

export const ifoodNuvemEvento = pgTable(
  'ifood_nuvem_evento',
  {
    /** id do evento no iFood — PK, então evento repetido não duplica. */
    id: varchar('id', { length: 80 }).primaryKey(),
    /** Filial dona do merchant. NULL = merchant sem credencial cadastrada
     *  (evento ainda assim é gravado e ackeado, pra não travar a fila). */
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'cascade' }),
    merchantId: varchar('merchant_id', { length: 80 }).notNull(),
    orderId: varchar('order_id', { length: 80 }).notNull(),
    /** PLACED, CONFIRMED, CANCELLED, … */
    codigo: varchar('codigo', { length: 40 }).notNull(),
    fullCode: varchar('full_code', { length: 60 }),
    ocorridoEm: timestamp('ocorrido_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    /** Ack mandado pro iFood. O Firefly Audit exige 100% de ack. */
    ackEm: timestamp('ack_em', { withTimezone: true }),
    /** A loja puxou este evento. */
    entregueEm: timestamp('entregue_em', { withTimezone: true }),
  },
  (t) => ({
    filaIdx: index('idx_ifood_nuvem_evento_fila').on(t.filialId, t.entregueEm),
    pedidoIdx: index('idx_ifood_nuvem_evento_pedido').on(t.orderId),
  }),
);

export const ifoodNuvemPedido = pgTable(
  'ifood_nuvem_pedido',
  {
    /** id do pedido no iFood. */
    orderId: varchar('order_id', { length: 80 }).primaryKey(),
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'cascade' }),
    merchantId: varchar('merchant_id', { length: 80 }).notNull(),
    displayId: varchar('display_id', { length: 20 }),
    /** GET /order/v1.0/orders/{id} inteiro — a loja projeta a comanda daqui. */
    payload: jsonb('payload').notNull(),
    baixadoEm: timestamp('baixado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ filialIdx: index('idx_ifood_nuvem_pedido_filial').on(t.filialId) }),
);

export const ifoodNuvemLease = pgTable('ifood_nuvem_lease', {
  /** Uma trava por client_id: é a fila que precisa de consumidor único. */
  chave: varchar('chave', { length: 80 }).primaryKey(),
  dono: varchar('dono', { length: 60 }).notNull(),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  /** Diagnóstico do último ciclo — é o que a tela /ifood mostra. */
  ultimoOk: timestamp('ultimo_ok', { withTimezone: true }),
  ultimoErro: text('ultimo_erro'),
  eventos: integer('eventos').notNull().default(0),
});
