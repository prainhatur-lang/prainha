// PORTADORES do dinheiro em espécie — quem está com o dinheiro que saiu da
// gaveta: o Cofre da casa e as pessoas que levam sangria (Elison, Marta…).
//
// Cada casa tem os seus portadores (o Cofre do Bar não é o da Mar). O saldo é
// a soma de `portador_movimento.valor` (positivo entra, negativo sai), sem as
// linhas excluídas:
//   SANGRIA   (+) caixa entregou ao portador — sobe da loja (/api/loja/caixa-saida)
//   ENTREGA   (−/+) um portador passou pro outro — duas linhas ligadas por `par_id`
//   DEPOSITO  (−) foi pro banco
//   PAGAMENTO (−) pagou alguma coisa com o dinheiro
//   ENTRADA   (+) recebeu dinheiro de fora da gaveta
//   AJUSTE    (±) saldo inicial / contagem
//
// Sangria cujo "quem leva" não bate com nenhum portador fica com
// `portador_id` nulo e aparece como "sem portador" até alguém atribuir.

import { pgTable, uuid, varchar, timestamp, text, numeric, date, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial, usuario } from './tenant';

export const portador = pgTable(
  'portador',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 80 }).notNull(),
    /** COFRE | PESSOA */
    tipo: varchar('tipo', { length: 10 }).notNull().default('PESSOA'),
    ativo: boolean('ativo').notNull().default(true),
    criadoPor: uuid('criado_por').references(() => usuario.id),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialNomeUq: uniqueIndex('uq_portador_filial_nome').on(t.filialId, t.nome),
  }),
);

export const portadorMovimento = pgTable(
  'portador_movimento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    portadorId: uuid('portador_id').references(() => portador.id),
    data: date('data').notNull(),
    tipo: varchar('tipo', { length: 12 }).notNull(),
    /** Positivo = entrou no portador; negativo = saiu. */
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    descricao: text('descricao'),
    /** Nome digitado no caixa ("quem está levando"), como veio. */
    quemLevou: varchar('quem_levou', { length: 120 }),
    /** 'sangria:<id da loja>' — idempotência do envio da loja. */
    codigoReferencia: varchar('codigo_referencia', { length: 60 }),
    /** ENTREGA: a outra metade (saída de um ↔ entrada do outro). */
    parId: uuid('par_id'),
    criadoPor: uuid('criado_por').references(() => usuario.id),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    excluidoEm: timestamp('excluido_em', { withTimezone: true }),
    excluidoPor: uuid('excluido_por').references(() => usuario.id),
  },
  (t) => ({
    filialDataIdx: index('idx_portador_mov_filial_data').on(t.filialId, t.data),
    portadorIdx: index('idx_portador_mov_portador').on(t.portadorId),
    refUq: uniqueIndex('uq_portador_mov_ref').on(t.filialId, t.codigoReferencia),
  }),
);
