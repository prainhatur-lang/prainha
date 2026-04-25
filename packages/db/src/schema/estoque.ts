// Estoque: ficha técnica, mapeamento produto×fornecedor, movimento.
//
// Design:
//  - `produto` (em vendas.ts) agora tem `tipo` e `unidadeEstoque` + `controlaEstoque`
//    - VENDA_SIMPLES: aparece no cardápio e baixa próprio estoque (ex: lata de Coca)
//    - VENDA_COMPOSTO: aparece no cardápio e baixa insumos via ficha técnica
//      (ex: Caipiroska = vodka + morango + ...)
//    - INSUMO: matéria-prima, só compra. Não vai pro cardápio do PDV.
//  - `ficha_tecnica`: produto composto → lista de insumos com quantidade
//  - `produto_fornecedor`: mapeia código/EAN do fornecedor pro produto interno
//    (N:N, permite múltiplos fornecedores pro mesmo produto — ex: Coca na Solar
//    ou na Assaí)
//  - `movimento_estoque`: toda entrada/saída registrada, na unidade de estoque
//    do produto (já convertida pelo fator)

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
import { notaCompraItem } from './notas';
import { pedidoItem } from './vendas';

/** Ficha técnica (BOM): produto composto → insumos com quantidade.
 *  A unidade da quantidade é a `unidadeEstoque` do insumo (ml, g, un).
 *
 *  Lógica final da baixa: uma linha gera SAIDA_FICHA_TECNICA apenas se
 *  `baixaEstoque = true` E `insumo.controlaEstoque = true`. Isso permite:
 *   - Flag por LINHA (ex: gelo decorativo desta receita específica não baixa)
 *   - Flag por INSUMO (ex: água, insumos "infinitos" nunca baixam em nenhuma receita)
 */
export const fichaTecnica = pgTable(
  'ficha_tecnica',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** Produto que "receita" (composto). Pode também ser VENDA_SIMPLES se
     *  alguém quiser modelar "1 caixa de cerveja = 12 latas" (1 pai vira 12 filhos). */
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'cascade' }),
    /** Insumo consumido. É outro registro em `produto` com tipo INSUMO (ou
     *  também VENDA_SIMPLES quando for revenda que ocasionalmente serve de ingrediente). */
    insumoId: uuid('insumo_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'restrict' }),
    /** Quantidade consumida por 1 unidade do produto, na unidade do insumo.
     *  Ex: 1 caipiroska = 50ml vodka → 50.
     *  Ex: 1 caixa de 12 cervejas = 12un lata → 12. */
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }).notNull(),
    /** Se esta linha específica gera movimento de estoque. Default true.
     *  Útil pra desligar baixa só em receitas específicas (ex: decoração simbólica). */
    baixaEstoque: boolean('baixa_estoque').notNull().default(true),
    /** Observação opcional (ex: "copo de 300ml", "decorar com casca de limão") */
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqProdInsumo: unique('uq_ficha_prod_insumo').on(t.produtoId, t.insumoId),
    produtoIdx: index('idx_ficha_produto').on(t.filialId, t.produtoId),
    insumoIdx: index('idx_ficha_insumo').on(t.filialId, t.insumoId),
  }),
);

/** Mapeamento produto interno × fornecedor. Permite que a mesma Coca 350ml
 *  tenha códigos diferentes na Solar (CC350) e na Assaí (7894900010015),
 *  além de embalagens diferentes (pack 12un, fardo 24un, unidade).
 *
 *  `fatorConversao` = quantas unidades do produto interno entram por
 *  1 unidade do fornecedor. Ex:
 *  - Compra 1 garrafa vodka 1L, produto é "Vodka (ml)" → fator 1000
 *  - Compra 1 fardo 12un cerveja, produto é "Cerveja lata (un)" → fator 12
 *  - Compra 1 lata avulsa, produto é "Lata (un)" → fator 1
 */
export const produtoFornecedor = pgTable(
  'produto_fornecedor',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'cascade' }),
    fornecedorId: uuid('fornecedor_id')
      .notNull()
      .references(() => fornecedor.id, { onDelete: 'cascade' }),
    /** cProd como vem na NF-e do fornecedor (string, pode ser EAN ou código interno dele) */
    codigoFornecedor: varchar('codigo_fornecedor', { length: 60 }),
    /** EAN específico (pode ser pack/fardo diferente do unitário) */
    ean: varchar('ean', { length: 20 }),
    /** Descrição como vem na NF do fornecedor — útil pra reconhecer depois */
    descricaoFornecedor: text('descricao_fornecedor'),
    /** Unidade que o fornecedor fatura (pacote, fardo, garrafa, cx, un) */
    unidadeFornecedor: varchar('unidade_fornecedor', { length: 10 }),
    /** Fator de conversão — ver comentário da tabela */
    fatorConversao: numeric('fator_conversao', { precision: 14, scale: 6 })
      .notNull()
      .default('1'),
    /** Último preço de custo por unidade do fornecedor (o que vem na NF) */
    ultimoPrecoCusto: numeric('ultimo_preco_custo', { precision: 14, scale: 4 }),
    /** Mesmo preço, mas normalizado pra unidade do produto (preço ÷ fator) */
    ultimoPrecoCustoUnidade: numeric('ultimo_preco_custo_unidade', {
      precision: 14,
      scale: 6,
    }),
    ultimaCompraEm: timestamp('ultima_compra_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Um mesmo codigoFornecedor dentro do fornecedor → sempre o mesmo produto
    uniqFornCodigo: unique('uq_prod_forn_codigo').on(t.fornecedorId, t.codigoFornecedor),
    produtoIdx: index('idx_prod_forn_produto').on(t.produtoId),
    fornecedorIdx: index('idx_prod_forn_fornecedor').on(t.fornecedorId),
    eanIdx: index('idx_prod_forn_ean').on(t.filialId, t.ean),
  }),
);

/** Colaborador (cozinheiro, açougueiro, garçom, etc). Texto cadastrado uma
 *  vez e reusado nas OPs. Não tem login na nuvem — só nome pra rastreabilidade.
 *  Os 'responsavel' livres das OPs antigas continuam funcionando, mas novos
 *  usam essa tabela via autocomplete. */
export const colaborador = pgTable(
  'colaborador',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 100 }).notNull(),
    /** Categoria livre — COZINHA / SALAO / PRODUCAO / etc. Default 'COZINHA'. */
    tipo: varchar('tipo', { length: 20 }).notNull().default('COZINHA'),
    ativo: boolean('ativo').notNull().default(true),
    /** Atualizada toda vez que o nome aparece numa OP (pra ordenar autocomplete). */
    ultimaAtividadeEm: timestamp('ultima_atividade_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqNome: unique('uq_colab_filial_nome').on(t.filialId, t.nome),
    tipoIdx: index('idx_colab_tipo').on(t.filialId, t.tipo),
  }),
);

/** Ordem de produção: transformação de insumos. Ex: 3kg Filé Mignon Bruto →
 *  2kg Medalhão + 500g Filé Grelha + 300g Aparas + 500g Perda.
 *  O custo total das entradas se redistribui proporcionalmente entre as
 *  saídas úteis (excluindo perdas). */
export const ordemProducao = pgTable(
  'ordem_producao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    descricao: varchar('descricao', { length: 200 }),
    dataHora: timestamp('data_hora', { withTimezone: true }).notNull().defaultNow(),
    /** RASCUNHO | CONCLUIDA | CANCELADA */
    status: varchar('status', { length: 20 }).notNull().default('RASCUNHO'),
    /** Se a soma das saídas (inclui perda) difere das entradas, diferença em % */
    divergenciaPercentual: numeric('divergencia_percentual', { precision: 8, scale: 4 }),
    /** Custo total das entradas (soma). Computado na conclusão. */
    custoTotalEntradas: numeric('custo_total_entradas', { precision: 14, scale: 2 }),
    /** Nome do cozinheiro/responsável que executou o porcionamento.
     *  Texto livre — cozinheiro normalmente não tem login. Usado pra análise
     *  comparativa de perda entre profissionais que fazem o mesmo corte. */
    responsavel: varchar('responsavel', { length: 100 }),
    observacao: text('observacao'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    concluidaEm: timestamp('concluida_em', { withTimezone: true }),
  },
  (t) => ({
    filialDataIdx: index('idx_op_filial_data').on(t.filialId, t.dataHora),
    statusIdx: index('idx_op_status').on(t.filialId, t.status),
  }),
);

/** Insumos que ENTRAM na produção (são consumidos). Ex: 3kg Filé Bruto. */
export const ordemProducaoEntrada = pgTable(
  'ordem_producao_entrada',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ordemProducaoId: uuid('ordem_producao_id')
      .notNull()
      .references(() => ordemProducao.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'restrict' }),
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }).notNull(),
    /** Custo unitário do insumo no momento (pega do último preço de compra) */
    precoUnitario: numeric('preco_unitario', { precision: 14, scale: 6 }),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }),
  },
  (t) => ({
    opIdx: index('idx_op_entrada_op').on(t.ordemProducaoId),
    produtoIdx: index('idx_op_entrada_produto').on(t.produtoId),
  }),
);

/** Insumos que SAEM da produção (são gerados) + PERDAS.
 *  Perda entra com tipo='PERDA' e não gera estoque (e absorve seu próprio
 *  custo proporcionalmente nos cortes úteis: o denominador do rateio é
 *  só sum(qtd*peso) das saídas PRODUTO).
 *
 *  Peso relativo: cortes nobres têm peso > 1, populares < 1. Ex: filé mignon:
 *  lâmina peso 3, cabeça peso 1, aparas peso 0.5. Default 1 (rateio só por qtd). */
export const ordemProducaoSaida = pgTable(
  'ordem_producao_saida',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ordemProducaoId: uuid('ordem_producao_id')
      .notNull()
      .references(() => ordemProducao.id, { onDelete: 'cascade' }),
    /** tipo: PRODUTO (gera estoque) | PERDA (absorvida no rateio) */
    tipo: varchar('tipo', { length: 10 }).notNull().default('PRODUTO'),
    /** null se for PERDA sem material identificado (pode também ser PRODUTO com produto_id) */
    produtoId: uuid('produto_id').references(() => produto.id, { onDelete: 'restrict' }),
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }).notNull(),
    /** Peso relativo no rateio. Default 1 = todos iguais. Maior = corte mais nobre,
     *  absorve proporcionalmente mais custo. Só faz efeito em saídas tipo PRODUTO. */
    pesoRelativo: numeric('peso_relativo', { precision: 8, scale: 4 }).notNull().default('1'),
    /** Custo unitário rateado (calculado ao concluir a OP). null enquanto RASCUNHO. */
    custoRateado: numeric('custo_rateado', { precision: 14, scale: 6 }),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }),
    observacao: text('observacao'),
  },
  (t) => ({
    opIdx: index('idx_op_saida_op').on(t.ordemProducaoId),
    produtoIdx: index('idx_op_saida_produto').on(t.produtoId),
  }),
);

/** Template de Ordem de Produção: receita reusável pra produções recorrentes.
 *  Ex: "Desossa Filé Mignon" — sempre 1 entrada de filé bruto + 4 saídas
 *  (lâmina/cabeça/aparas/perda). Quando criar uma OP a partir do template,
 *  o sistema preenche entradas e saídas com as quantidades-padrão
 *  (proporcionais), e o user só ajusta a qtd da entrada principal e o sistema
 *  escala o resto. */
export const templateOp = pgTable(
  'template_op',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 200 }).notNull(),
    descricaoPadrao: varchar('descricao_padrao', { length: 200 }),
    observacao: text('observacao'),
    ativo: boolean('ativo').notNull().default(true),
    /** Vezes que esse template foi usado pra criar OP. Pra ordenar autocomplete. */
    vezesUsado: integer('vezes_usado').notNull().default(0),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqNome: unique('uq_tpl_op_nome').on(t.filialId, t.nome),
    ativoIdx: index('idx_tpl_op_ativo').on(t.filialId, t.ativo),
  }),
);

export const templateOpEntrada = pgTable(
  'template_op_entrada',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templateOp.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'restrict' }),
    /** Quantidade-padrão. Quando o user cria OP, pode ajustar e o sistema
     *  escala TODAS as saídas proporcionalmente. */
    quantidadePadrao: numeric('quantidade_padrao', { precision: 14, scale: 4 }).notNull(),
  },
  (t) => ({
    tplIdx: index('idx_tpl_entrada_tpl').on(t.templateId),
  }),
);

export const templateOpSaida = pgTable(
  'template_op_saida',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templateOp.id, { onDelete: 'cascade' }),
    /** PRODUTO ou PERDA */
    tipo: varchar('tipo', { length: 10 }).notNull().default('PRODUTO'),
    produtoId: uuid('produto_id').references(() => produto.id, { onDelete: 'restrict' }),
    quantidadePadrao: numeric('quantidade_padrao', { precision: 14, scale: 4 }).notNull(),
    pesoRelativo: numeric('peso_relativo', { precision: 8, scale: 4 }).notNull().default('1'),
    observacao: text('observacao'),
  },
  (t) => ({
    tplIdx: index('idx_tpl_saida_tpl').on(t.templateId),
  }),
);

/** Movimento de estoque. + = entrada, - = saída. Sempre na unidade do produto.
 *  Pra saldo atual: SUM(quantidade) WHERE produto_id = X. */
export const movimentoEstoque = pgTable(
  'movimento_estoque',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'cascade' }),
    /**
     * ENTRADA_COMPRA      (NFe de entrada)
     * SAIDA_VENDA         (revenda direta: lata de Coca)
     * SAIDA_FICHA_TECNICA (insumo baixado por venda de composto)
     * SAIDA_PRODUCAO      (insumo consumido em ordem de produção)
     * ENTRADA_PRODUCAO    (insumo gerado por ordem de produção)
     * ENTRADA_AJUSTE | SAIDA_AJUSTE
     * ENTRADA_DEVOLUCAO | SAIDA_DEVOLUCAO
     * PERDA              (descarte, vencimento)
     */
    tipo: varchar('tipo', { length: 30 }).notNull(),
    /** Positivo pra entrada, negativo pra saída, na unidade do produto. */
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }).notNull(),
    /** Preço unitário na unidade do produto (já dividido pelo fator) */
    precoUnitario: numeric('preco_unitario', { precision: 14, scale: 6 }),
    /** Preço total do movimento (quantidade * preço) — pode ser null em ajustes */
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }),
    dataHora: timestamp('data_hora', { withTimezone: true }).notNull(),
    /** Referências da origem */
    notaCompraItemId: uuid('nota_compra_item_id').references(() => notaCompraItem.id, {
      onDelete: 'set null',
    }),
    pedidoItemId: uuid('pedido_item_id').references(() => pedidoItem.id, {
      onDelete: 'set null',
    }),
    ordemProducaoId: uuid('ordem_producao_id').references(() => ordemProducao.id, {
      onDelete: 'set null',
    }),
    /** Se é um movimento derivado de ficha técnica, aponta pro movimento pai (venda do composto) */
    movimentoPaiId: uuid('movimento_pai_id'),
    observacao: text('observacao'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    produtoDataIdx: index('idx_mov_est_produto_data').on(t.filialId, t.produtoId, t.dataHora),
    dataIdx: index('idx_mov_est_data').on(t.filialId, t.dataHora),
    tipoIdx: index('idx_mov_est_tipo').on(t.filialId, t.tipo),
    notaIdx: index('idx_mov_est_nota').on(t.notaCompraItemId),
    pedidoIdx: index('idx_mov_est_pedido').on(t.pedidoItemId),
    opIdx: index('idx_mov_est_op').on(t.ordemProducaoId),
  }),
);
