// Modulo de Cotacao + Pedido de Compra.
//
// Fluxo:
//   1. Restaurante cria cotacao (lista de itens com qtd) -> cotacao_item
//   2. Sistema dispara pra N fornecedores -> cotacao_fornecedor (1 link unico por fornecedor)
//   3. Fornecedor abre o link, preenche preco/marca por item -> cotacao_resposta_item
//   4. Janela de resposta fecha (default 4h) -> sistema seleciona vencedor por item (mais barato dentre marcas aceitas)
//   5. Gestor aprova com 1 clique -> gera pedido_compra (1 por fornecedor que ganhou algo) -> pedido_compra_item
//   6. Pedido fica visivel pra reconciliacao com NF quando chegar
//
// Status da cotacao:
//   RASCUNHO -> ABERTA -> AGUARDANDO_APROVACAO -> APROVADA -> CONCLUIDA
//                                              \-> CANCELADA
//
// Status da resposta do fornecedor:
//   PENDENTE -> RESPONDIDA -> VENCEDORA / PERDEDORA
//             \-> NAO_RESPONDEU (timeout)

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  numeric,
  boolean,
  integer,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { produto } from './vendas';
import { fornecedor } from './financeiro';
import { marca } from './compras';

/** Cabecalho da cotacao. Uma cotacao agrega itens que serao cotados juntos
 *  com varios fornecedores ao mesmo tempo. */
export const cotacao = pgTable(
  'cotacao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** Numero sequencial humano-friendly por filial. Ex: 1, 2, 3... */
    numero: integer('numero').notNull(),
    /** RASCUNHO | ABERTA | AGUARDANDO_APROVACAO | APROVADA | CONCLUIDA | CANCELADA */
    status: varchar('status', { length: 30 }).notNull().default('RASCUNHO'),
    /** Quando a cotacao foi disparada pros fornecedores (status -> ABERTA) */
    abertaEm: timestamp('aberta_em', { withTimezone: true }),
    /** Quando a janela de resposta fecha (abertaEm + duracaoHoras). Default 4h. */
    fechaEm: timestamp('fecha_em', { withTimezone: true }),
    /** Janela de resposta em horas. Default 4. */
    duracaoHoras: integer('duracao_horas').notNull().default(4),
    /** Quem aprovou os vencedores (gestor com login). */
    aprovadaPor: uuid('aprovada_por'),
    aprovadaEm: timestamp('aprovada_em', { withTimezone: true }),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    canceladaPor: uuid('cancelada_por'),
    motivoCancelamento: text('motivo_cancelamento'),
    observacao: text('observacao'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqNumero: unique('uq_cotacao_filial_numero').on(t.filialId, t.numero),
    statusIdx: index('idx_cotacao_status').on(t.filialId, t.status),
    fechaIdx: index('idx_cotacao_fecha').on(t.fechaEm),
  }),
);

/** Item da cotacao. Liga ao produto interno + marcas_aceitas (snapshot do
 *  produto_marca_aceita no momento da criacao — preserva historico se as
 *  marcas aceitas mudarem depois). */
export const cotacaoItem = pgTable(
  'cotacao_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cotacaoId: uuid('cotacao_id')
      .notNull()
      .references(() => cotacao.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'restrict' }),
    /** Quantidade desejada. Pode ser fracionaria (5.5kg). */
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }).notNull(),
    /** Unidade da quantidade (un, kg, g, ml, l). Espelha produto.unidadeEstoque. */
    unidade: varchar('unidade', { length: 10 }).notNull(),
    /** Snapshot das marcas aceitas no momento da criacao (CSV separado por |).
     *  Vazio = qualquer marca aceita. */
    marcasAceitas: text('marcas_aceitas'),
    /** Observacao livre pro fornecedor (ex: "preferencialmente fresco"). */
    observacao: text('observacao'),
    /** Apos selecao do vencedor, aponta pra resposta vencedora. Null enquanto pendente. */
    respostaVencedoraId: uuid('resposta_vencedora_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cotacaoIdx: index('idx_cotacao_item_cotacao').on(t.cotacaoId),
    produtoIdx: index('idx_cotacao_item_produto').on(t.produtoId),
  }),
);

/** Convocacao de cotacao pra um fornecedor especifico. 1 cotacao -> N
 *  fornecedores convocados, cada um com seu link unico publico. */
export const cotacaoFornecedor = pgTable(
  'cotacao_fornecedor',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cotacaoId: uuid('cotacao_id')
      .notNull()
      .references(() => cotacao.id, { onDelete: 'cascade' }),
    fornecedorId: uuid('fornecedor_id')
      .notNull()
      .references(() => fornecedor.id, { onDelete: 'restrict' }),
    /** Token publico de 32 bytes pra acessar /cotacao/preencher/[token].
     *  Sem login do fornecedor. Expira junto com cotacao.fechaEm. */
    tokenPublico: varchar('token_publico', { length: 64 }).notNull().unique(),
    /** Data/hora que o link foi enviado por WhatsApp (manual ou via integracao) */
    linkEnviadoEm: timestamp('link_enviado_em', { withTimezone: true }),
    /** Primeira vez que o fornecedor abriu o link */
    linkAbertoEm: timestamp('link_aberto_em', { withTimezone: true }),
    /** Quando submeteu resposta (ou null se nao respondeu) */
    respondidoEm: timestamp('respondido_em', { withTimezone: true }),
    /** PENDENTE | RESPONDIDA | NAO_RESPONDEU (apos timeout) */
    status: varchar('status', { length: 20 }).notNull().default('PENDENTE'),
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCotForn: unique('uq_cotforn_cotacao_fornecedor').on(t.cotacaoId, t.fornecedorId),
    cotacaoIdx: index('idx_cotforn_cotacao').on(t.cotacaoId),
    fornecedorIdx: index('idx_cotforn_fornecedor').on(t.fornecedorId),
    statusIdx: index('idx_cotforn_status').on(t.status),
  }),
);

/** Resposta do fornecedor pra um item. Pode ser vazia se ele nao tem o item.
 *  N respostas por cotacao_item (1 por fornecedor convocado).
 *
 *  Marca: o fornecedor escolhe entre as marcas aceitas (se a cotacao tinha)
 *  ou marca livre (se nao tinha restricao).
 *
 *  Preco: unitario na unidade do item. Se fornecedor cota em outra unidade
 *  (ex: cx), o sistema converte usando produto_fornecedor.fator_conversao
 *  (ou pede o fornecedor preencher o fator). */
export const cotacaoRespostaItem = pgTable(
  'cotacao_resposta_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cotacaoFornecedorId: uuid('cotacao_fornecedor_id')
      .notNull()
      .references(() => cotacaoFornecedor.id, { onDelete: 'cascade' }),
    cotacaoItemId: uuid('cotacao_item_id')
      .notNull()
      .references(() => cotacaoItem.id, { onDelete: 'cascade' }),
    /** Marca cotada. Pode ser texto livre se o fornecedor cotou marca nao
     *  cadastrada — vai cair em "rejeitada" se o item tinha marcas restritas. */
    marcaId: uuid('marca_id').references(() => marca.id, { onDelete: 'set null' }),
    marcaTextoLivre: varchar('marca_texto_livre', { length: 100 }),
    /** Preco unitario na unidade do cotacao_item.unidade.
     *  null = fornecedor nao tem o item essa semana. */
    precoUnitario: numeric('preco_unitario', { precision: 14, scale: 4 }),
    /** Unidade que o fornecedor cotou (cx, fardo, un, kg). */
    unidadeFornecedor: varchar('unidade_fornecedor', { length: 10 }),
    /** Fator de conversao da unidade do fornecedor pra unidade do item.
     *  Ex: cotou 1 fardo = 12 un, fator = 12, preco_unitario_normalizado = preco_unit / 12 */
    fatorConversao: numeric('fator_conversao', { precision: 14, scale: 6 }).notNull().default('1'),
    /** Preco unit normalizado (preco_unit / fator) — ja na unidade do item. Pra comparacao direta. */
    precoUnitarioNormalizado: numeric('preco_unitario_normalizado', { precision: 14, scale: 6 }),
    /** Observacao do fornecedor (ex: "validade curta", "promocao") */
    observacao: text('observacao'),
    respondidoEm: timestamp('respondido_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqRespItem: unique('uq_resposta_cotforn_item').on(t.cotacaoFornecedorId, t.cotacaoItemId),
    cotforn: index('idx_resp_cotforn').on(t.cotacaoFornecedorId),
    item: index('idx_resp_item').on(t.cotacaoItemId),
  }),
);

/** Pedido de compra: gerado apos aprovacao da cotacao. 1 cotacao aprovada
 *  -> N pedidos (1 por fornecedor que ganhou algo). Quando NF chega depois,
 *  reconcilia com pedido_compra_item via produto_id + cotacao_id.
 *
 *  Status:
 *   GERADO -> ENVIADO -> ENTREGUE_PARCIAL / ENTREGUE_TOTAL -> RECONCILIADO
 *                     \-> CANCELADO
 *
 *  RECONCILIADO = NF chegou e foi vinculada (todos os itens do pedido tem
 *  produto_id casado em algum nota_compra_item). */
export const pedidoCompra = pgTable(
  'pedido_compra',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    cotacaoId: uuid('cotacao_id').references(() => cotacao.id, { onDelete: 'set null' }),
    fornecedorId: uuid('fornecedor_id')
      .notNull()
      .references(() => fornecedor.id, { onDelete: 'restrict' }),
    /** Numero sequencial por filial */
    numero: integer('numero').notNull(),
    /** GERADO | ENVIADO | ENTREGUE_PARCIAL | ENTREGUE_TOTAL | RECONCILIADO | CANCELADO */
    status: varchar('status', { length: 30 }).notNull().default('GERADO'),
    /** Total estimado do pedido (soma dos itens) */
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }),
    /** Quando o pedido foi enviado pro fornecedor (manual via WhatsApp ou auto) */
    enviadoEm: timestamp('enviado_em', { withTimezone: true }),
    /** Data prevista de entrega informada pelo fornecedor */
    previsaoEntrega: timestamp('previsao_entrega', { withTimezone: true }),
    /** Nota fiscal de entrada quando reconciliar */
    notaCompraId: uuid('nota_compra_id'),
    reconciliadoEm: timestamp('reconciliado_em', { withTimezone: true }),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    motivoCancelamento: text('motivo_cancelamento'),
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqNumero: unique('uq_pedido_compra_filial_numero').on(t.filialId, t.numero),
    cotacaoIdx: index('idx_pedido_compra_cotacao').on(t.cotacaoId),
    fornecedorIdx: index('idx_pedido_compra_fornecedor').on(t.fornecedorId),
    statusIdx: index('idx_pedido_compra_status').on(t.filialId, t.status),
  }),
);

/** Item do pedido de compra. Espelha cotacao_resposta_item vencedora. */
export const pedidoCompraItem = pgTable(
  'pedido_compra_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pedidoCompraId: uuid('pedido_compra_id')
      .notNull()
      .references(() => pedidoCompra.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'restrict' }),
    /** Resposta vencedora da cotacao que gerou esse item */
    respostaVencedoraId: uuid('resposta_vencedora_id').references(
      () => cotacaoRespostaItem.id,
      { onDelete: 'set null' },
    ),
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }).notNull(),
    unidade: varchar('unidade', { length: 10 }).notNull(),
    marcaId: uuid('marca_id').references(() => marca.id, { onDelete: 'set null' }),
    /** Preco fechado (na unidade do item, ja normalizado se fornecedor cotou outra) */
    precoUnitario: numeric('preco_unitario', { precision: 14, scale: 4 }).notNull(),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull(),
    /** Quantidade efetivamente recebida quando NF chega (preenchido na reconciliacao) */
    quantidadeRecebida: numeric('quantidade_recebida', { precision: 14, scale: 4 }),
    /** Item da NF que casou com esse item do pedido */
    notaCompraItemId: uuid('nota_compra_item_id'),
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pedidoIdx: index('idx_pedido_item_pedido').on(t.pedidoCompraId),
    produtoIdx: index('idx_pedido_item_produto').on(t.produtoId),
  }),
);
