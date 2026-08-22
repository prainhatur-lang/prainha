import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { filial } from './tenant';

/** bytea — o drizzle não traz esse tipo pro Postgres. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** Cancelamento de item (ou do pedido inteiro) feito no caixa do vendas-local,
 *  COM motivo e quem autorizou — o Consumer só marca ITENSPEDIDO.DATADELETE.
 *  A loja grava na tabela local `cancelamento` e manda pra cá em lote pelo
 *  /api/loja/cancelamentos; (filial_id, id_local) é a chave de idempotência. */
export const cancelamentoItem = pgTable(
  'cancelamento_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** cancelamento.id na loja */
    idLocal: bigint('id_local', { mode: 'number' }).notNull(),
    quando: timestamp('quando', { withTimezone: true }).notNull(),
    /** item · pedido (pedido inteiro) */
    tipo: varchar('tipo', { length: 10 }).notNull(),
    /** quem cancelou (login do caixa) */
    login: varchar('login', { length: 60 }),
    /** quem autorizou (gerente) — igual ao login quando ele mesmo é gerente */
    gerente: varchar('gerente', { length: 60 }),
    /** mesa/comanda */
    numero: integer('numero'),
    pedidoFb: integer('pedido_fb'),
    itemCodigo: bigint('item_codigo', { mode: 'number' }),
    nome: text('nome'),
    valor: numeric('valor', { precision: 14, scale: 2 }),
    /** a_produzir · em_producao · pronto · entregue · pedido — se já tinha saído da cozinha, é desperdício */
    statusItem: varchar('status_item', { length: 20 }),
    motivo: text('motivo'),
    areaCodigo: integer('area_codigo'),
    /** Foto do produto devolvido (motivo "Devolução…") — JPEG ~1280px, vem da loja. */
    foto: bytea('foto'),
    fotoMime: varchar('foto_mime', { length: 40 }),
    recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unicoLoja: uniqueIndex('ci_filial_id_local').on(t.filialId, t.idLocal),
    porData: index('ci_filial_quando').on(t.filialId, t.quando),
  }),
);
