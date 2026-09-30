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
import { date, index, numeric, pgTable, serial, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
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
    /** ABERTA | COMPENSADA | CANCELADA */
    status: varchar('status', { length: 12 }).notNull().default('ABERTA'),
    encontroId: uuid('encontro_id'),
    observacao: text('observacao'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    canceladoPor: uuid('cancelado_por'),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
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
