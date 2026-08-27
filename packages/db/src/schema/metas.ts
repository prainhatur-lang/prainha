// Metas e premiação de equipe/filial (Fase 2 do RH). Só de equipe/filial
// por enquanto — a única métrica confiável por pessoa hoje é fraca e não
// conversa com o cadastro novo de funcionário.
//
// Avaliação é MANUAL (nunca cron) — dashboardFechamento lê dados que ainda
// se mexem (janela de refetch de 14 dias), então um cron do dia 1 pagaria
// sobre mês incompleto.
//
// meta_equipe_rateio é snapshot IMUTÁVEL gravado no momento da avaliação —
// reabrir a folha depois de uma correção de ponto não pode mudar valor já
// rateado (o valor entra em folha_ajuste com tipo='premiacao' só quando
// vinculado a uma folha aberta, e a folha nunca recalcula o rateio).

import { pgTable, uuid, varchar, numeric, integer, date, timestamp, boolean, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { fornecedor } from './financeiro';
import { folhaSemana } from './folha';

export const metaEquipe = pgTable(
  'meta_equipe',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 200 }).notNull(),
    /** 'faturamento'|'faturamento_liquido'|'ticket_medio'|'servico'|'pedidos'|'avaliacao_media' */
    metrica: varchar('metrica', { length: 30 }).notNull(),
    /** Meta bate quando realizado >= alvo. */
    valorAlvo: numeric('valor_alvo', { precision: 12, scale: 2 }).notNull(),
    /** 'YYYY-MM' — mês de referência (5 das 6 métricas vêm de
     *  dashboardFechamento, que é mensal). */
    competencia: varchar('competencia', { length: 7 }).notNull(),
    dataInicio: date('data_inicio').notNull(), // 1º dia da competência
    dataFim: date('data_fim').notNull(), // último dia da competência
    /** Valor total a distribuir SE a meta for batida. */
    premiacaoTotal: numeric('premiacao_total', { precision: 10, scale: 2 }).notNull(),

    /** aberta (progresso ao vivo, nada gravado) | avaliada (bateu ou não,
     *  rateio gravado se bateu) | vinculada (rateio já entrou numa folha) |
     *  cancelada. */
    status: varchar('status', { length: 20 }).notNull().default('aberta'),
    valorRealizado: numeric('valor_realizado', { precision: 12, scale: 2 }),
    bateuMeta: boolean('bateu_meta'),
    /** Cópia da regra (métrica/alvo/premiacaoTotal) no momento de avaliar —
     *  auditoria caso a meta base seja editada depois. */
    regraSnapshot: jsonb('regra_snapshot'),

    folhaSemanaVinculadaId: uuid('folha_semana_vinculada_id').references(() => folhaSemana.id, { onDelete: 'set null' }),

    avaliadaEm: timestamp('avaliada_em', { withTimezone: true }),
    avaliadaPor: uuid('avaliada_por'),
    vinculadaEm: timestamp('vinculada_em', { withTimezone: true }),
    vinculadaPor: uuid('vinculada_por'),

    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialCompetenciaIdx: index('idx_meta_equipe_filial_competencia').on(t.filialId, t.competencia),
    statusIdx: index('idx_meta_equipe_status').on(t.filialId, t.status),
  }),
);

/** Rateio congelado por pessoa, gerado na avaliação (só existe se bateuMeta). */
export const metaEquipeRateio = pgTable(
  'meta_equipe_rateio',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    metaEquipeId: uuid('meta_equipe_id').notNull().references(() => metaEquipe.id, { onDelete: 'cascade' }),
    fornecedorId: uuid('fornecedor_id').notNull().references(() => fornecedor.id, { onDelete: 'cascade' }),
    /** Snapshot do nome no momento — fornecedor pode ter o nome editado depois. */
    pessoaNome: varchar('pessoa_nome', { length: 200 }).notNull(),
    minutosTrabalhados: integer('minutos_trabalhados').notNull(),
    valorRateado: numeric('valor_rateado', { precision: 10, scale: 2 }).notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    metaIdx: index('idx_meta_equipe_rateio_meta').on(t.metaEquipeId),
    uniq: unique('uq_meta_equipe_rateio_meta_pessoa').on(t.metaEquipeId, t.fornecedorId),
  }),
);
