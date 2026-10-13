// Faturas de CARTÃO DE CRÉDITO da empresa — o arquivo do banco (PDF, planilha
// ou CSV) enviado em /financeiro/cartoes e os lançamentos lidos dele, um por
// compra, pra classificar a despesa (categoria + casa) e cruzar com as notas
// de entrada.
//
// O cartão é da EMPRESA, não de uma casa: a fatura fica na organização e a
// casa é de cada compra (`cartao_lancamento.filial_id`, nulo = a decidir).
//
// Nada aqui gera conta a pagar, baixa ou lançamento: é o registro do que o
// banco cobrou. O pagamento da fatura continua sendo lançado como sempre.

import { pgTable, uuid, varchar, timestamp, integer, text, numeric, date, index, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizacao, filial, usuario } from './tenant';

export const cartaoFatura = pgTable(
  'cartao_fatura',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizacaoId: uuid('organizacao_id')
      .notNull()
      .references(() => organizacao.id, { onDelete: 'cascade' }),
    /** Lidos do arquivo (nulos enquanto não leu ou se a leitura falhou). */
    banco: varchar('banco', { length: 60 }),
    /** Final do cartão que dá nome à fatura (o do titular). */
    cartaoFinal: varchar('cartao_final', { length: 8 }),
    titular: varchar('titular', { length: 120 }),
    vencimento: date('vencimento'),
    /** Total que o BANCO informa para os lançamentos da fatura. */
    total: numeric('total', { precision: 14, scale: 2 }),
    /** Soma do que foi lido — tem que bater com `total`. */
    somaLida: numeric('soma_lida', { precision: 14, scale: 2 }),
    qtdLancamentos: integer('qtd_lancamentos').notNull().default(0),
    /** LIDA (soma bate) | DIVERGE (leu, soma não bate) | ERRO (não leu) */
    status: varchar('status', { length: 12 }).notNull().default('ERRO'),
    erro: text('erro'),
    nomeOriginal: text('nome_original').notNull(),
    /** Caminho no bucket privado `extratos-fechamento`, pasta `cartoes/`. */
    storagePath: text('storage_path').notNull().unique(),
    contentType: varchar('content_type', { length: 120 }),
    tamanhoBytes: integer('tamanho_bytes'),
    enviadoPor: uuid('enviado_por').references(() => usuario.id),
    enviadoEm: timestamp('enviado_em', { withTimezone: true }).notNull().defaultNow(),
    /** Retirada da lista (arquivo errado ou substituída por outro envio da
     *  mesma fatura). O arquivo continua no bucket. */
    excluidoEm: timestamp('excluido_em', { withTimezone: true }),
    excluidoPor: uuid('excluido_por').references(() => usuario.id),
  },
  (t) => ({
    orgVencIdx: index('idx_cartao_fatura_org_venc').on(t.organizacaoId, t.vencimento),
  }),
);

export const cartaoLancamento = pgTable(
  'cartao_lancamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    faturaId: uuid('fatura_id')
      .notNull()
      .references(() => cartaoFatura.id, { onDelete: 'cascade' }),
    organizacaoId: uuid('organizacao_id')
      .notNull()
      .references(() => organizacao.id, { onDelete: 'cascade' }),
    /** Posição na fatura, pra listar na ordem do banco. */
    ordem: integer('ordem').notNull().default(0),
    /** Cartão que fez a compra (o titular ou um adicional). */
    cartaoFinal: varchar('cartao_final', { length: 8 }),
    dataCompra: date('data_compra'),
    estabelecimento: text('estabelecimento').notNull(),
    parcela: integer('parcela'),
    totalParcelas: integer('total_parcelas'),
    /** Valor cobrado NESTA fatura. Negativo = estorno/crédito. */
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    /** Categoria sugerida pela regra do estabelecimento (lib/cartao-fatura). */
    categoria: varchar('categoria', { length: 60 }),
    /** Casa da despesa. Nulo = ainda não decidida. */
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'set null' }),
    /** Despesa dividida entre casas (banco de dados do sistema, hospedagem):
     *  as casas que racham, em partes iguais. Com rateio, filial_id fica nulo. */
    rateio: jsonb('rateio').$type<string[]>(),
  },
  (t) => ({
    faturaIdx: index('idx_cartao_lanc_fatura').on(t.faturaId, t.ordem),
    orgDataIdx: index('idx_cartao_lanc_org_data').on(t.organizacaoId, t.dataCompra),
  }),
);
