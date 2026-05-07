// Folha de pagamento da equipe (garcons / diaristas / gerente).
//
// Modelo: divisao do 10% (taxa de servico) entre empresa, gerente e
// funcionarios proporcionalmente as horas trabalhadas. Diaristas recebem
// uma diaria fixa por hora ALEM do rateio do 10%.
//
// Ciclo: semana de seg a dom. Toda segunda fecha a folha da semana
// anterior.
//
// IMPORTANTE: pessoas que recebem folha NAO tem cadastro proprio — usam
// `fornecedor` (com classificacao "Salarios" no plano de contas). A
// tabela `fornecedor_folha` eh um satelite 1:1 que adiciona infos
// especificas de folha (papel, taxas, modelo gerente).
//
// Quando uma folha eh fechada, o sistema gera N lancamentos em
// `conta_pagar` (1 comissao + 1 diaria + 1 gratificacao + 1 transporte
// por pessoa, conforme aplicavel) com `folha_semana_id` apontando de
// volta — pra rastreabilidade e reversao.

import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  date,
  timestamp,
  boolean,
  unique,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { filial } from './tenant';
import { fornecedor, categoriaConta } from './financeiro';

/** Satelite 1:1 com `fornecedor`. So existe pra fornecedores que recebem
 *  folha (garcons, diaristas, gerentes). Outros fornecedores nao tem
 *  linha aqui. */
export const fornecedorFolha = pgTable(
  'fornecedor_folha',
  {
    fornecedorId: uuid('fornecedor_id')
      .primaryKey()
      .references(() => fornecedor.id, { onDelete: 'cascade' }),
    /** Papel pra calculo da folha. */
    papel: varchar('papel', { length: 20 }).notNull(), // funcionario|diarista|gerente
    /** Pra papel='gerente': como remunera. */
    gerenteModelo: varchar('gerente_modelo', { length: 20 }), // 1pp_dos_10pct | fixo_por_dia
    /** Pra gerente fixo: valor por dia trabalhado. */
    gerenteValorFixoDia: numeric('gerente_valor_fixo_dia', { precision: 10, scale: 2 }),
    /** Override da taxa diarista pra essa pessoa especifica (opcional).
     *  Se null, usa o padrao da filial (folha_config.taxa_diarista_hora). */
    diaristaTaxaHoraOverride: numeric('diarista_taxa_hora_override', { precision: 10, scale: 2 }),
    /** Codigo do colaborador no Consumer (PEDIDOS.CODIGOCOLABORADOR) — pra
     *  vincular automaticamente a comissao gerada via PDV (Consumer ja
     *  atribui o garcom ao pedido). */
    codigoColaboradorExterno: integer('codigo_colaborador_externo'),
    /** Nomes alternativos detectados em outras fontes (espelho de ponto,
     *  PDV, etc). Permite fuzzy match auto na sincronizacao. */
    nomesAlternativos: jsonb('nomes_alternativos'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    papelIdx: index('idx_fornecedor_folha_papel').on(t.papel, t.ativo),
  }),
);

/** Configuracao da folha por filial. 1:1 com filial. */
export const folhaConfig = pgTable(
  'folha_config',
  {
    filialId: uuid('filial_id').primaryKey().references(() => filial.id, { onDelete: 'cascade' }),
    /** Divisao dos 10pp do 10%. Soma deve ser 10. */
    ppEmpresa: numeric('pp_empresa', { precision: 5, scale: 2 }).notNull().default('1'),
    ppGerente: numeric('pp_gerente', { precision: 5, scale: 2 }).notNull().default('1'),
    ppFuncionarios: numeric('pp_funcionarios', { precision: 5, scale: 2 }).notNull().default('8'),
    /** Taxa padrao da diaria (R$/hora) — diaristas. */
    taxaDiaristaHora: numeric('taxa_diarista_hora', { precision: 10, scale: 2 }).notNull().default('8.00'),
    /** Auxilio transporte. */
    auxTransporteAtivo: boolean('aux_transporte_ativo').notNull().default(false),
    auxTransporteValorHora: numeric('aux_transporte_valor_hora', { precision: 10, scale: 2 }),
    /** Dias da semana em que paga transporte: { seg:true, ter:true, ... } */
    auxTransporteDias: jsonb('aux_transporte_dias'),
    /** IDs das categorias do plano de contas usadas ao gerar conta_pagar.
     *  Filial pode ter categorias diferentes — guardar IDs explicitos
     *  evita lookup por nome (que e fragil). */
    categoriaComissaoId: uuid('categoria_comissao_id').references(() => categoriaConta.id, { onDelete: 'set null' }),
    categoriaDiariaId: uuid('categoria_diaria_id').references(() => categoriaConta.id, { onDelete: 'set null' }),
    categoriaGratificacaoId: uuid('categoria_gratificacao_id').references(() => categoriaConta.id, { onDelete: 'set null' }),
    categoriaTransporteId: uuid('categoria_transporte_id').references(() => categoriaConta.id, { onDelete: 'set null' }),
    /** Dia da semana em que a folha eh paga. 1=segunda, 7=domingo.
     *  Default 1 (segunda — folha da semana anterior). */
    diaPagamento: integer('dia_pagamento').notNull().default(1),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
);

/** Instancia de folha pra uma semana especifica de uma filial.
 *  data_inicio sempre eh segunda, data_fim sempre eh domingo. */
export const folhaSemana = pgTable(
  'folha_semana',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    dataInicio: date('data_inicio').notNull(), // segunda
    dataFim: date('data_fim').notNull(),       // domingo
    status: varchar('status', { length: 20 }).notNull().default('aberta'), // aberta|fechada|cancelada
    /** Snapshot do total de 10% por dia (sum de pedido.total_servico).
     *  { '2026-04-27': 340.64, '2026-04-28': 810.40, ... } */
    dezPctPorDia: jsonb('dez_pct_por_dia').notNull().default(sql`'{}'`),
    /** Snapshot da config no momento de fechar (pra reproducibilidade). */
    configSnapshot: jsonb('config_snapshot'),
    /** Data de pagamento prevista (default: segunda da semana seguinte). */
    dataPagamento: date('data_pagamento'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    fechadaEm: timestamp('fechada_em', { withTimezone: true }),
    fechadaPor: uuid('fechada_por'), // user.id que fechou
  },
  (t) => ({
    uniqSemana: unique('uq_folha_semana_filial_inicio').on(t.filialId, t.dataInicio),
    statusIdx: index('idx_folha_semana_status').on(t.filialId, t.status),
  }),
);

/** Horas trabalhadas por fornecedor (pessoa) por dia.
 *  Vem do upload do espelho de ponto OU input manual. Guardado em
 *  minutos pra precisao. */
export const folhaHoras = pgTable(
  'folha_horas',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    folhaSemanaId: uuid('folha_semana_id').notNull().references(() => folhaSemana.id, { onDelete: 'cascade' }),
    fornecedorId: uuid('fornecedor_id').notNull().references(() => fornecedor.id, { onDelete: 'cascade' }),
    dia: date('dia').notNull(),
    /** Total de minutos trabalhados naquele dia. */
    totalMin: integer('total_min').notNull().default(0),
    /** Origem da info: 'espelho' (XLSX) | 'pdv' (PEDIDOS.codigo_colaborador) | 'manual'. */
    origem: varchar('origem', { length: 20 }).notNull().default('manual'),
  },
  (t) => ({
    uniqPessoaDia: unique('uq_folha_horas_pessoa_dia').on(t.folhaSemanaId, t.fornecedorId, t.dia),
  }),
);
