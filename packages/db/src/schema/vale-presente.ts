// Vale-presente pré-pago (jantar de presente).
//
// Caso Thai, Tabuará 24/10/2026: cliente quer presentear um casal com um
// jantar. A Nina (Otávio na Tabuará) monta o menu com itens do cardápio
// (preço do sistema) + 10% de serviço, gera o Pix e manda o link. Pago, o
// link vira o VOUCHER QUITADO com código — o casal mostra na casa e a equipe
// confere/dá baixa em /reservas/vales-presente.

import { pgTable, uuid, varchar, integer, serial, date, numeric, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export interface ItemValePresente {
  nome: string;
  tamanho?: string;
  qtd: number;
  preco: number;
}

export const valePresente = pgTable(
  'vale_presente',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    numero: serial('numero'),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Código curto que o casal mostra na casa (ex.: "VP-7K3Q"). */
    codigo: varchar('codigo', { length: 12 }).notNull().unique(),
    /** Token do link público /presente/[token]. */
    token: text('token').notNull().unique(),
    compradorNome: varchar('comprador_nome', { length: 200 }).notNull(),
    compradorTelefone: varchar('comprador_telefone', { length: 30 }),
    /** Quem vai usar (ex.: "Ana e Pedro"). */
    presenteados: varchar('presenteados', { length: 200 }),
    mensagem: text('mensagem'),
    /** Dia previsto do jantar (YYYY-MM-DD). Null = em aberto. */
    dataUso: date('data_uso'),
    pessoas: integer('pessoas').notNull().default(2),
    itens: jsonb('itens').$type<ItemValePresente[]>().notNull().default(sql`'[]'::jsonb`),
    subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
    servico: numeric('servico', { precision: 10, scale: 2 }).notNull(),
    total: numeric('total', { precision: 10, scale: 2 }).notNull(),
    /** aguardando | pago | usado | cancelado | reembolsado */
    status: varchar('status', { length: 20 }).notNull().default('aguardando'),
    pagamentoId: varchar('pagamento_id', { length: 50 }),
    pagamentoQrcode: text('pagamento_qrcode'),
    pagamentoQrcodeImg: text('pagamento_qrcode_img'),
    pagoEm: timestamp('pago_em', { withTimezone: true }),
    usadoEm: timestamp('usado_em', { withTimezone: true }),
    usadoPor: varchar('usado_por', { length: 160 }),
    observacao: text('observacao'),
    criadoPor: varchar('criado_por', { length: 160 }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialCriadoIdx: index('vale_presente_filial_criado_idx').on(t.filialId, t.criadoEm),
  }),
);
