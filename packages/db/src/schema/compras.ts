// Modulo de Compras / Cotacao.
//
// Conceitos:
//  - `marca`: marca de produto (Coca-Cola, Tio João, Camil, Heineken, ...).
//    Per filial pra simplicidade — cada filial mantem seu cadastro proprio
//    de marcas conhecidas (ainda que na pratica sejam globais).
//  - `produto_marca_aceita`: marcas que o restaurante aceita comprar pra
//    aquele produto. Ex: Arroz branco aceita Tio Urbano, Camil ou Tio João.
//    Vazio = qualquer marca aceita.
//
// Fluxo de cotacao (tabelas a serem criadas em proxima fase):
//  cotacao -> cotacao_item -> cotacao_fornecedor (link unico) ->
//  cotacao_resposta_item (preço por marca preenchido pelo fornecedor) ->
//  pedido_compra (vencedor consolidado) -> nota_compra (NF que chega).

import { pgTable, uuid, varchar, boolean, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { produto } from './vendas';

/** Marca de produto. Cadastro por filial.
 *  Ex: "Coca-Cola", "Tio João", "Heineken", "Sicão", "Callebaut". */
export const marca = pgTable(
  'marca',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 100 }).notNull(),
    /** Inativa = nao aparece no autocomplete, mas mantém histórico. */
    ativa: boolean('ativa').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqNome: unique('uq_marca_filial_nome').on(t.filialId, t.nome),
    nomeIdx: index('idx_marca_nome').on(t.filialId, t.nome),
  }),
);

/** Marcas aceitas pra um produto especifico. N:N entre produto e marca.
 *  Vazio = qualquer marca aceita (fornecedor cota livre).
 *  Preenchido = sistema so considera cotacoes nessas marcas (filtra antes
 *  de comparar preco). */
export const produtoMarcaAceita = pgTable(
  'produto_marca_aceita',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'cascade' }),
    marcaId: uuid('marca_id')
      .notNull()
      .references(() => marca.id, { onDelete: 'cascade' }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqProdMarca: unique('uq_pma_produto_marca').on(t.produtoId, t.marcaId),
    produtoIdx: index('idx_pma_produto').on(t.filialId, t.produtoId),
    marcaIdx: index('idx_pma_marca').on(t.filialId, t.marcaId),
  }),
);
