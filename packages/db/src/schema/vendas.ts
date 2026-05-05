// Tabelas de vendas do Consumer (espelho): Produto, Pedido, PedidoItem.
import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  numeric,
  boolean,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/** Produto (espelha PRODUTOS do Consumer + campos próprios do concilia).
 *
 *  Tipos (mapeia Consumer CODIGOPRODUTOTIPO):
 *   - VENDA_SIMPLES (1 Produto): aparece no cardápio. Se tiver linhas em
 *     ficha_tecnica, baixa os insumos. Caso contrário baixa o próprio estoque
 *     (ex: lata de Coca = revenda direta).
 *   - INSUMO (2): só compra, nunca no cardápio. Baixa via ficha_tecnica
 *     quando outro produto composto é vendido.
 *   - COMPLEMENTO (3): adicional (bacon, queijo extra). Igual VENDA_SIMPLES.
 *   - COMBO (4): vários produtos com preço fechado. Ficha lista os filhos.
 *   - VARIANTE (5 Produto por Tamanho): o pai do cardápio (ex: Pizza M).
 *     No pedido, vem o pai + itens filhos (sabores) via codigoPai do
 *     pedido_item. A ficha real fica no filho (Sabor Calabresa, etc.).
 *   - SERVICO (6): taxa de entrega, couvert — não mexe estoque.
 *
 *  `unidadeEstoque` é a unidade do estoque interno (ml, g, un, kg).
 *  Isso difere da `codigoUnidadeComercial` do Consumer, que é pra venda.
 */
export const produto = pgTable(
  'produto',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** Null pra insumos criados direto na nuvem (não existem no Consumer). */
    codigoExterno: integer('codigo_externo'),
    nome: varchar('nome', { length: 200 }),
    descricao: text('descricao'),
    codigoPersonalizado: varchar('codigo_personalizado', { length: 50 }),
    codigoEtiqueta: varchar('codigo_etiqueta', { length: 50 }),
    precoVenda: numeric('preco_venda', { precision: 14, scale: 4 }),
    precoCusto: numeric('preco_custo', { precision: 14, scale: 4 }),
    estoqueAtual: numeric('estoque_atual', { precision: 14, scale: 3 }),
    estoqueMinimo: numeric('estoque_minimo', { precision: 14, scale: 3 }),
    estoqueControlado: boolean('estoque_controlado'),
    descontinuado: boolean('descontinuado'),
    /** Data em que o produto foi pausado (null = nao pausado). Espelha
     *  DATAPAUSADO do PRODUTODETALHE do Consumer. Pausado != Descontinuado:
     *  pausa e temporario (ex: ruptura de estoque, falta de insumo); descontinuado
     *  e definitivo. */
    dataPausado: timestamp('data_pausado', { withTimezone: true }),
    itemPorKg: boolean('item_por_kg'),
    /** Peso em kg de 1 unidade do produto. Usado quando produto eh vendido
     *  em un mas comprado/medido em kg (ex: 1 un de file = 1 kg).
     *  Permite conversao automatica entre as duas unidades em entradas de
     *  OP, ingest de NFe, e baixa de estoque. Null = nao tem conversao
     *  (1 un = 1 un, sem peso definido). */
    pesoUnitarioPadraoKg: numeric('peso_unitario_padrao_kg', { precision: 14, scale: 4 }),
    codigoUnidadeComercial: integer('codigo_unidade_comercial'),
    codigoProdutoTipo: integer('codigo_produto_tipo'),
    codigoCozinha: integer('codigo_cozinha'),
    ncm: varchar('ncm', { length: 10 }),
    cfop: varchar('cfop', { length: 10 }),
    cest: varchar('cest', { length: 10 }),

    // ---- Campos próprios do concilia (gestão de estoque + ficha técnica) ----

    /** Tipo do produto: VENDA_SIMPLES | VENDA_COMPOSTO | INSUMO */
    tipo: varchar('tipo', { length: 20 }).notNull().default('VENDA_SIMPLES'),
    /** Unidade de estoque (pra insumos e revenda): un, ml, g, kg, l */
    unidadeEstoque: varchar('unidade_estoque', { length: 10 }).notNull().default('un'),
    /** Se deve controlar estoque (entrada por compra / saída por venda ou ficha).
     *  VENDA_SIMPLES: pode controlar ou não (revenda sim, composto filho sim).
     *  VENDA_COMPOSTO: geralmente false (só os insumos controlam).
     *  INSUMO: sempre true.
     *  Default true. */
    controlaEstoque: boolean('controla_estoque').notNull().default(true),
    /** Categoria do modulo de Compras/Cotacao (Confeitaria, Estoque seco,
     *  Hortifruti, Limpeza, Proteina, Refrigeracao, Utensilios, Bebidas - *).
     *  Independente da categoria fiscal/cardapio — usado pra agrupar a UI da
     *  cotacao e pra rotear cotacao pro fornecedor que cobre cada categoria.
     *  Null pra produtos que nao entram no fluxo de cotacao. */
    categoriaCompras: varchar('categoria_compras', { length: 50 }),
    /** Criado só na nuvem (não veio do Consumer) — útil pra insumos. */
    criadoNaNuvem: boolean('criado_na_nuvem').notNull().default(false),

    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // codigoExterno só é único quando não é null (insumos da nuvem têm null).
    uniqCodigo: unique('uq_produto_filial_codigo').on(t.filialId, t.codigoExterno),
    nomeIdx: index('idx_produto_nome').on(t.filialId, t.nome),
    tipoIdx: index('idx_produto_tipo').on(t.filialId, t.tipo),
    etiquetaIdx: index('idx_produto_etiqueta').on(t.filialId, t.codigoEtiqueta),
  }),
);

/** Pedido/Venda (cabecalho). Espelha PEDIDOS. */
export const pedido = pgTable(
  'pedido',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    numero: integer('numero'),
    senha: varchar('senha', { length: 30 }),
    codigoClienteContatoExterno: integer('codigo_cliente_contato_externo'),
    codigoClienteFiadoExterno: integer('codigo_cliente_fiado_externo'),
    nomeCliente: varchar('nome_cliente', { length: 200 }),
    codigoColaborador: integer('codigo_colaborador'),
    codigoUsuarioCriador: integer('codigo_usuario_criador'),
    dataAbertura: timestamp('data_abertura', { withTimezone: true }),
    dataFechamento: timestamp('data_fechamento', { withTimezone: true }),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }),
    valorTotalItens: numeric('valor_total_itens', { precision: 14, scale: 2 }),
    subtotalPago: numeric('subtotal_pago', { precision: 14, scale: 2 }),
    totalDesconto: numeric('total_desconto', { precision: 14, scale: 2 }),
    // numeric(8,4) estourava em 10000.0000 — alguns Consumer mandam o
    // percentual em base 10000 (10000 = 100%) ou valores anomalos.
    // Ampliamos pra (14,4) pra acomodar qualquer base sem rejeitar.
    percentualDesconto: numeric('percentual_desconto', { precision: 14, scale: 4 }),
    totalAcrescimo: numeric('total_acrescimo', { precision: 14, scale: 2 }),
    totalServico: numeric('total_servico', { precision: 14, scale: 2 }),
    percentualTaxaServico: numeric('percentual_taxa_servico', { precision: 14, scale: 4 }),
    valorEntrega: numeric('valor_entrega', { precision: 14, scale: 2 }),
    valorTroco: numeric('valor_troco', { precision: 14, scale: 2 }),
    valorIva: numeric('valor_iva', { precision: 14, scale: 2 }),
    quantidadePessoas: integer('quantidade_pessoas'),
    notaEmitida: boolean('nota_emitida'),
    tag: varchar('tag', { length: 100 }),
    codigoPedidoOrigem: integer('codigo_pedido_origem'),
    codigoCupom: integer('codigo_cupom'),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_pedido_filial_codigo').on(t.filialId, t.codigoExterno),
    dataIdx: index('idx_pedido_data').on(t.filialId, t.dataFechamento),
    clienteIdx: index('idx_pedido_cliente').on(t.filialId, t.codigoClienteContatoExterno),
  }),
);

/** Item do pedido (espelha ITENSPEDIDO). */
export const pedidoItem = pgTable(
  'pedido_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoPedidoExterno: integer('codigo_pedido_externo').notNull(),
    codigoProdutoExterno: integer('codigo_produto_externo'),
    pedidoId: uuid('pedido_id').references(() => pedido.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id').references(() => produto.id, { onDelete: 'set null' }),
    nomeProduto: varchar('nome_produto', { length: 200 }),
    quantidade: numeric('quantidade', { precision: 14, scale: 3 }),
    valorUnitario: numeric('valor_unitario', { precision: 14, scale: 4 }),
    precoCusto: numeric('preco_custo', { precision: 14, scale: 4 }),
    valorItem: numeric('valor_item', { precision: 14, scale: 2 }),
    valorComplemento: numeric('valor_complemento', { precision: 14, scale: 2 }),
    valorFilho: numeric('valor_filho', { precision: 14, scale: 2 }),
    valorDesconto: numeric('valor_desconto', { precision: 14, scale: 2 }),
    valorGorjeta: numeric('valor_gorjeta', { precision: 14, scale: 2 }),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }),
    codigoPai: integer('codigo_pai'),
    codigoItemPedidoTipo: integer('codigo_item_pedido_tipo'),
    codigoPagamento: integer('codigo_pagamento'),
    codigoColaborador: integer('codigo_colaborador'),
    dataHoraCadastro: timestamp('data_hora_cadastro', { withTimezone: true }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    detalhes: text('detalhes'),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_pedido_item_filial_codigo').on(t.filialId, t.codigoExterno),
    pedidoIdx: index('idx_pedido_item_pedido').on(t.filialId, t.codigoPedidoExterno),
    produtoIdx: index('idx_pedido_item_produto').on(t.filialId, t.codigoProdutoExterno),
  }),
);
