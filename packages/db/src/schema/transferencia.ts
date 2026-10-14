// Transferência de mercadoria entre casas (Bar → Mar, Tabuará → Bar…).
//
// Regra do dono (30/09/2026): quem RECEBE fica devendo pra quem ENVIOU, pelo
// custo médio da casa que enviou. Cada transferência gera:
//   - SAIDA_TRANSFERENCIA no estoque da origem (custo médio vigente)
//   - ENTRADA_TRANSFERENCIA no estoque do destino (mesmo custo, entra no MPM)
//   - 1 conta_pagar no destino (origem='TRANSFERENCIA') — o "a receber" da
//     origem é a própria transferência em aberto.
// Uma vez por mês o encontro de contas compensa as transferências de cada par
// de casas: baixa as contas por compensação e sobra 1 conta_pagar só com a
// diferença, na casa que deve (origem='ENCONTRO_CONTAS'), paga de verdade.

import { sql } from 'drizzle-orm';
import { boolean, date, index, numeric, pgTable, serial, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { filial } from './tenant';
import { produto } from './vendas';
import { notaCompra } from './notas';

export const transferenciaFilial = pgTable(
  'transferencia_filial',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    numero: serial('numero').notNull(),
    filialOrigemId: uuid('filial_origem_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    filialDestinoId: uuid('filial_destino_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Dia da transferência (BRT) */
    data: date('data').notNull(),
    /** YYYY-MM — mês do encontro de contas */
    competencia: varchar('competencia', { length: 7 }).notNull(),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull(),
    /** Quando saiu de uma nota lançada ("Transferir pra outra casa" na nota) */
    notaCompraId: uuid('nota_compra_id').references(() => notaCompra.id, { onDelete: 'set null' }),
    /** Conta a pagar gerada no DESTINO (uuid raw — evita ciclo de import) */
    contaPagarId: uuid('conta_pagar_id'),
    /** ENVIADA | ABERTA | COMPENSADA | CANCELADA.
     *  ENVIADA = em trânsito: já saiu do estoque da origem, mas a casa que
     *  recebe ainda não conferiu — sem entrada no destino e sem conta a pagar.
     *  Ao conferir (receberTransferencia) vira ABERTA. */
    status: varchar('status', { length: 12 }).notNull().default('ABERTA'),
    encontroId: uuid('encontro_id'),
    observacao: text('observacao'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    canceladoPor: uuid('cancelado_por'),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    /** Conferência na casa que recebe (quando deu entrada no estoque) */
    recebidaEm: timestamp('recebida_em', { withTimezone: true }),
    recebidaPor: uuid('recebida_por'),
    observacaoRecebimento: text('observacao_recebimento'),
  },
  (t) => ({
    origemIdx: index('idx_transf_origem').on(t.filialOrigemId, t.competencia),
    destinoIdx: index('idx_transf_destino').on(t.filialDestinoId, t.competencia),
    notaIdx: index('idx_transf_nota').on(t.notaCompraId),
  }),
);

export const transferenciaFilialItem = pgTable(
  'transferencia_filial_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    transferenciaId: uuid('transferencia_id')
      .notNull()
      .references(() => transferenciaFilial.id, { onDelete: 'cascade' }),
    produtoOrigemId: uuid('produto_origem_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'restrict' }),
    produtoDestinoId: uuid('produto_destino_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'restrict' }),
    /** Nome do produto na origem no momento (histórico) */
    descricao: text('descricao'),
    /** Na unidade de estoque do produto */
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }).notNull(),
    custoUnitario: numeric('custo_unitario', { precision: 14, scale: 6 }).notNull(),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull(),
    movSaidaId: uuid('mov_saida_id'),
    movEntradaId: uuid('mov_entrada_id'),
    /** O que a casa que recebe conferiu (null = ainda não conferiu, ou
     *  transferência antiga com entrada direta = quantidade). A diferença
     *  volta pro estoque da origem. */
    quantidadeRecebida: numeric('quantidade_recebida', { precision: 14, scale: 4 }),
    /** Origem estava sem custo médio: o custo é estimado/informado */
    custoEstimado: boolean('custo_estimado').notNull().default(false),
  },
  (t) => ({
    transfIdx: index('idx_transf_item_transf').on(t.transferenciaId),
  }),
);

/** Um encontro por PAR de casas por competência. */
export const encontroContas = pgTable(
  'encontro_contas',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    competencia: varchar('competencia', { length: 7 }).notNull(),
    /** Quem ficou devendo a diferença (se empatou, qualquer uma das duas) */
    filialDevedoraId: uuid('filial_devedora_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    filialCredoraId: uuid('filial_credora_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Total que a devedora recebeu da credora no período */
    valorDevedora: numeric('valor_devedora', { precision: 14, scale: 2 }).notNull(),
    /** Total que a credora recebeu da devedora (abatido) */
    valorCredora: numeric('valor_credora', { precision: 14, scale: 2 }).notNull(),
    valorLiquido: numeric('valor_liquido', { precision: 14, scale: 2 }).notNull(),
    /** Conta a pagar da diferença, na devedora (null se zerou) */
    contaPagarId: uuid('conta_pagar_id'),
    data: date('data').notNull(),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    compIdx: index('idx_encontro_comp').on(t.competencia),
  }),
);

/** Boleto que uma casa pagou com o dinheiro dela pra uma conta lançada em
 *  OUTRA casa (o Inter do Bar pagou a tinta da Mar). Decisão do dono
 *  (14/10/2026): a conta fica na casa dela, baixada normalmente, e quem teve a
 *  conta paga fica devendo pra quem pagou — entra no encontro de contas do mês
 *  do pagamento, junto com as transferências. */
export const pagamentoEntreCasas = pgTable(
  'pagamento_entre_casas',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Casa de onde saiu o dinheiro (credora no encontro) */
    filialPagadoraId: uuid('filial_pagadora_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Casa da conta (devedora no encontro) */
    filialDevedoraId: uuid('filial_devedora_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Conta a pagar da devedora que o pagamento quitou (uuid raw — evita ciclo de import) */
    contaPagarId: uuid('conta_pagar_id'),
    /** INTER_BOLETO = lido da API de pagamentos do Inter da pagadora */
    origem: varchar('origem', { length: 20 }).notNull().default('INTER_BOLETO'),
    /** codigoTransacao do Inter — o mesmo pagamento não entra duas vezes */
    codigoExterno: text('codigo_externo'),
    /** Dia em que o banco pagou */
    data: date('data').notNull(),
    /** YYYY-MM — mês do encontro de contas (o do pagamento) */
    competencia: varchar('competencia', { length: 7 }).notNull(),
    /** O que saiu do banco da pagadora (com juros) */
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    descricao: text('descricao'),
    /** ABERTO | COMPENSADO | CANCELADO */
    status: varchar('status', { length: 12 }).notNull().default('ABERTO'),
    encontroId: uuid('encontro_id'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    canceladoPor: uuid('cancelado_por'),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
  },
  (t) => ({
    codigoUq: unique('uq_pag_casas_codigo').on(t.filialPagadoraId, t.codigoExterno),
    compIdx: index('idx_pag_casas_comp').on(t.competencia, t.status),
  }),
);

/** DE/PARA de produto entre casas: o mesmo item com nome diferente em cada
 *  casa ("Picanha Black Angus" no Bar = "Picanha Angus kg" na Mar). Gravado
 *  sozinho a cada transferência (as duas direções), e é o primeiro lugar onde
 *  a tela procura o produto na casa que recebe. */
export const produtoDeparaFilial = pgTable(
  'produto_depara_filial',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    produtoOrigemId: uuid('produto_origem_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'cascade' }),
    filialDestinoId: uuid('filial_destino_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    produtoDestinoId: uuid('produto_destino_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'cascade' }),
    atualizadoPor: uuid('atualizado_por'),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_depara_origem_destino').on(t.produtoOrigemId, t.filialDestinoId),
  }),
);
