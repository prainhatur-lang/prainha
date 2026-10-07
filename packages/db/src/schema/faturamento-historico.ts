// Histórico de faturamento (VGV) — aba do dono, com senha própria.
//
// O faturamento do PDV sai AO VIVO da tabela `pedido` (mesmo critério do
// fechamento: soma de valor_total por data_fechamento, sem os apagados). Estas
// tabelas guardam só o que o sistema NÃO sabe:
//   - o passado que veio da planilha do dono (meses antes de o PDV gravar o
//     total do pedido — Prainha Bar mar/2019 a nov/2022);
//   - as unidades que não rodam no sistema (AquaArena, Lara X);
//   - eventos e festas vendidos fora do PDV (somam por cima do mês).
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  index,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizacao, filial } from './tenant';

/** Uma linha do VGV: casa do sistema (filialId preenchido) ou unidade de fora. */
export const faturamentoUnidade = pgTable(
  'faturamento_unidade',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizacaoId: uuid('organizacao_id')
      .notNull()
      .references(() => organizacao.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 80 }).notNull(),
    /** Casa do sistema → o PDV responde pelos meses a partir de sistemaDesde. */
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'set null' }),
    /** 1º dia do primeiro mês em que o total do PDV vale. Antes disso, só lançamento. */
    sistemaDesde: date('sistema_desde'),
    ordem: integer('ordem').notNull().default(0),
    ativa: boolean('ativa').notNull().default(true),
    /** Quando a planilha do dono entrou nesta unidade (a importação é uma vez só). */
    planilhaEm: timestamp('planilha_em', { withTimezone: true }),
    /**
     * 1º dia do primeiro mês em que a unidade NÃO opera mais (o dono marca na
     * aba). Dali em diante o mês em branco não é pendência nem entra na
     * comparação — o histórico anterior continua contando.
     */
    encerradaDesde: date('encerrada_desde'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_faturamento_unidade_nome').on(t.organizacaoId, t.nome)],
);

/**
 * Valor digitado de um mês.
 *   TOTAL = o mês fechado inteiro (onde o sistema não tem o número) — um só
 *           por unidade/mês;
 *   EXTRA = evento ou festa fora do PDV — soma por cima do que o sistema tem;
 *           pode ter vários no mesmo mês (cada evento é uma linha).
 */
export const faturamentoLancamento = pgTable(
  'faturamento_lancamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    unidadeId: uuid('unidade_id')
      .notNull()
      .references(() => faturamentoUnidade.id, { onDelete: 'cascade' }),
    ano: integer('ano').notNull(),
    mes: integer('mes').notNull(),
    tipo: varchar('tipo', { length: 10 }).notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    observacao: text('observacao'),
    /** 'planilha' = importado da planilha do dono; 'manual' = digitado na aba. */
    origem: varchar('origem', { length: 20 }).notNull().default('manual'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_faturamento_lancamento_total')
      .on(t.unidadeId, t.ano, t.mes)
      .where(sql`${t.tipo} = 'TOTAL'`),
    index('idx_faturamento_lancamento_unidade').on(t.unidadeId, t.ano, t.mes),
  ],
);

/**
 * Senha da aba (uma por organização). Guarda só o hash (scrypt + sal); o
 * `segredo` assina o passe que fica no cookie depois de a senha conferir —
 * trocar a senha troca o segredo e derruba todo passe antigo.
 */
export const faturamentoAcesso = pgTable('faturamento_acesso', {
  organizacaoId: uuid('organizacao_id')
    .primaryKey()
    .references(() => organizacao.id, { onDelete: 'cascade' }),
  senhaHash: text('senha_hash').notNull(),
  senhaSalt: text('senha_salt').notNull(),
  segredo: text('segredo').notNull(),
  tentativas: integer('tentativas').notNull().default(0),
  bloqueadoAte: timestamp('bloqueado_ate', { withTimezone: true }),
  definidaPor: uuid('definida_por'),
  definidaEm: timestamp('definida_em', { withTimezone: true }).notNull().defaultNow(),
});
