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
import { fornecedor, categoriaConta, cliente } from './financeiro';

/** Satelite 1:1 com `fornecedor`. So existe pra fornecedores que recebem
 *  folha (garcons, diaristas, gerentes). Outros fornecedores nao tem
 *  linha aqui. */
export const fornecedorFolha = pgTable(
  'fornecedor_folha',
  {
    fornecedorId: uuid('fornecedor_id')
      .primaryKey()
      .references(() => fornecedor.id, { onDelete: 'cascade' }),
    /** Cliente correspondente no PDV (mesmo CPF). Usado pra ler o saldo
     *  de fiado em `movimento_conta_corrente` e abater como desconto na
     *  comissao. NULL = pessoa nao tem cadastro como cliente — fiado
     *  fica manual. Vinculo automatico via CPF (com fallback fuzzy nome). */
    clienteId: uuid('cliente_id').references(() => cliente.id, { onDelete: 'set null' }),
    /** Papel pra calculo da folha. */
    papel: varchar('papel', { length: 20 }).notNull(), // funcionario|diarista|gerente
    /** Pra papel='gerente': como remunera. */
    gerenteModelo: varchar('gerente_modelo', { length: 20 }), // 1pp_dos_10pct | fixo_por_dia
    /** Pra gerente fixo: valor por dia trabalhado. */
    gerenteValorFixoDia: numeric('gerente_valor_fixo_dia', { precision: 10, scale: 2 }),
    /** Override da taxa diarista pra essa pessoa especifica (opcional).
     *  Se null, usa o padrao da filial (folha_config.taxa_diarista_hora).
     *  So tem efeito quando diarista_modelo='por_hora'. */
    diaristaTaxaHoraOverride: numeric('diarista_taxa_hora_override', { precision: 10, scale: 2 }),
    /** Modelo de remuneracao do diarista:
     *  'por_hora'     -> taxa × horas (default; usa override OU padrao da filial)
     *  'fixo_por_dia' -> diarista_valor_fixo_dia × dias_com_horas>0 */
    diaristaModelo: varchar('diarista_modelo', { length: 20 }).notNull().default('por_hora'),
    /** Valor fixo por dia trabalhado, usado quando diarista_modelo='fixo_por_dia'.
     *  Ex: Lilian R$150/dia independente de horas. */
    diaristaValorFixoDia: numeric('diarista_valor_fixo_dia', { precision: 10, scale: 2 }),
    /** Bônus fixo semanal (opcional). Quando preenchido, entra como
     *  acréscimo automático em toda folha desse fornecedor — sem precisar
     *  lançar manualmente cada semana. Útil pra gerentes/fiscais/etc com
     *  bônus recorrente. NULL = sem bônus fixo. */
    bonusFixoSemanal: numeric('bonus_fixo_semanal', { precision: 10, scale: 2 }),
    /** Bônus por dia trabalhado (opcional). Quando preenchido, gera
     *  acréscimo = dias_com_horas_>_0 × valor. Diferente do bonus_fixo_semanal
     *  porque escala com os dias batidos no espelho. */
    bonusPorDia: numeric('bonus_por_dia', { precision: 10, scale: 2 }),
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
    categoriaPremiacaoId: uuid('categoria_premiacao_id').references(() => categoriaConta.id, { onDelete: 'set null' }),
    /** Dia da semana em que a folha eh paga. 1=segunda, 7=domingo.
     *  Default 1 (segunda — folha da semana anterior). */
    diaPagamento: integer('dia_pagamento').notNull().default(1),
    /** % estimada de encargos (INSS patronal+RAT+terceiros) sobre o salario
     *  CLT — varia por regime tributario da empresa terceirizada, nao da pra
     *  calcular com precisao sem acesso ao sistema dela. AJUSTAVEL; a tela
     *  deixa claro que e estimativa a confirmar com a contabilidade. */
    pctEncargosClt: numeric('pct_encargos_clt', { precision: 5, scale: 2 }).notNull().default('20.00'),
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

/** Ajuste manual (acrescimo/desconto) por pessoa numa folha. Usado pra
 *  registrar fiados, gratificacoes, abatimentos antes de fechar a folha.
 *  Quando a folha fecha, esses valores entram nos lancamentos do conta_pagar
 *  (descontos abatem comissao; acrescimos viram lancamento de Gratificacao). */
export const folhaAjuste = pgTable(
  'folha_ajuste',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    folhaSemanaId: uuid('folha_semana_id')
      .notNull()
      .references(() => folhaSemana.id, { onDelete: 'cascade' }),
    fornecedorId: uuid('fornecedor_id')
      .notNull()
      .references(() => fornecedor.id, { onDelete: 'cascade' }),
    tipo: varchar('tipo', { length: 20 }).notNull(), // acrescimo|desconto|premiacao
    valor: numeric('valor', { precision: 10, scale: 2 }).notNull(),
    descricao: varchar('descricao', { length: 200 }),
    /** 'manual' | 'fiado_auto' (puxado de cliente.saldo_atual_conta_corrente)
     *  | 'meta_premiacao' (rateio congelado de meta_equipe_rateio). */
    origem: varchar('origem', { length: 20 }).notNull().default('manual'),
    /** Só preenchido quando origem='meta_premiacao' — de qual meta veio.
     *  Usado pra reverter (reabrir meta) sem tocar em outros ajustes. */
    metaEquipeId: uuid('meta_equipe_id').references(() => metaEquipe.id, { onDelete: 'set null' }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pessoaIdx: index('idx_folha_ajuste_folha').on(t.folhaSemanaId, t.fornecedorId),
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
