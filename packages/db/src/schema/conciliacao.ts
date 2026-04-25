// Resultado das conciliacoes
import { pgTable, uuid, varchar, timestamp, numeric, jsonb, index, text, date, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { pagamento } from './pdv';

/**
 * Estado de conciliacao por pagamento (registro do PDV).
 * Cada pagamento tem 1 status atual de conciliacao.
 */
export const conciliacaoPagamento = pgTable(
  'conciliacao_pagamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pagamentoId: uuid('pagamento_id')
      .notNull()
      .references(() => pagamento.id, { onDelete: 'cascade' })
      .unique(),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** etapa atual: COMPLETO | NAO_NA_CIELO_VENDA | SEM_AGENDA_RECEBIVEL | NAO_PAGO_NO_BANCO | DIVERGENCIA_VALOR */
    etapa: varchar('etapa', { length: 30 }).notNull(),
    vendaAdquirenteId: uuid('venda_adquirente_id'),
    recebivelAdquirenteId: uuid('recebivel_adquirente_id'),
    /** lista de IDs de lancamento_banco que cobrem este pagamento */
    lancamentosBancoIds: jsonb('lancamentos_banco_ids').$type<string[]>(),
    valorDivergencia: numeric('valor_divergencia', { precision: 14, scale: 2 }),
    detalhes: jsonb('detalhes').$type<Record<string, unknown>>(),
    rodadoEm: timestamp('rodado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialEtapaIdx: index('conc_filial_etapa_idx').on(t.filialId, t.etapa),
  }),
);

/**
 * Excecoes acionaveis para o dashboard. Cada uma representa um problema
 * que precisa de atencao humana (ou aceite explicito).
 */
export const excecao = pgTable(
  'excecao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** qual processo de conciliacao gerou: OPERADORA | BANCO */
    processo: varchar('processo', { length: 20 }),
    /** referencia ao pagamento que gerou (se aplicavel) */
    pagamentoId: uuid('pagamento_id').references(() => pagamento.id, { onDelete: 'cascade' }),
    /** referencia a venda Cielo (quando excecao eh sobre a venda) */
    vendaAdquirenteId: uuid('venda_adquirente_id'),
    /** referencia a recebivel Cielo */
    recebivelAdquirenteId: uuid('recebivel_adquirente_id'),
    /** referencia a lancamento bancario */
    lancamentoBancoId: uuid('lancamento_banco_id'),
    tipo: varchar('tipo', { length: 50 }).notNull(),
    severidade: varchar('severidade', { length: 20 }).notNull(),
    descricao: text('descricao').notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }),
    detectadoEm: timestamp('detectado_em', { withTimezone: true }).notNull().defaultNow(),
    /** se foi reconhecida pelo usuario */
    aceitaEm: timestamp('aceita_em', { withTimezone: true }),
    aceitaPor: uuid('aceita_por'),
    observacao: text('observacao'),
  },
  (t) => ({
    filialIdx: index('excecao_filial_idx').on(t.filialId, t.detectadoEm),
    abertasIdx: index('excecao_abertas_idx').on(t.filialId).where(sql`aceita_em IS NULL`),
    processoIdx: index('excecao_processo_idx').on(t.filialId, t.processo),
  }),
);

/**
 * Fechamento de periodo: trava um dia/processo/filial. Apos fechar, o engine
 * nao reprocessa pagamentos desse dia e as excecoes ficam read-only.
 * Granularidade eh dia (um registro por dia). Soh DONO pode fechar/reabrir.
 */
export const fechamentoConciliacao = pgTable(
  'fechamento_conciliacao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** OPERADORA | RECEBIVEIS | BANCO */
    processo: varchar('processo', { length: 20 }).notNull(),
    /** Dia trancado (data da transacao). */
    data: date('data').notNull(),
    fechadoEm: timestamp('fechado_em', { withTimezone: true }).notNull().defaultNow(),
    fechadoPor: uuid('fechado_por'),
    observacao: text('observacao'),
  },
  (t) => ({
    uniq: index('fechamento_unique_idx').on(t.filialId, t.processo, t.data),
    filialIdx: index('fechamento_filial_idx').on(t.filialId, t.processo),
  }),
);

/**
 * Mapeamento de forma de pagamento (texto vindo do Consumer) → canal de
 * liquidação. Determina por qual fluxo o pagamento deve ser conciliado:
 *
 *  - ADQUIRENTE: PDV → Cielo → Banco (cartões, Pix maquininha, voucher)
 *  - DIRETO:     PDV → Banco          (Pix Manual, TED, DOC)
 *  - CAIXA:      PDV → Conferência caixa (dinheiro)
 *  - INTERNA:    PDV → Contas a receber (fiado, vale-funcionário)
 *
 * Uma linha por (filialId, formaPagamento). O texto vem exatamente como
 * aparece em pagamento.formaPagamento. O agente local pode criar entries
 * automaticamente (com canal sugerido por heurística) e o usuário ajusta
 * em /configuracoes/formas-pagamento.
 */
export const formaPagamentoCanal = pgTable(
  'forma_pagamento_canal',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    formaPagamento: varchar('forma_pagamento', { length: 255 }).notNull(),
    /** ADQUIRENTE | DIRETO | CAIXA | INTERNA */
    canal: varchar('canal', { length: 20 }).notNull().default('ADQUIRENTE'),
    /** True quando foi setado por heurística (vs editado pelo user) */
    sugerido: timestamp('sugerido_em', { withTimezone: true }),
    confirmadoPor: uuid('confirmado_por'),
    confirmadoEm: timestamp('confirmado_em', { withTimezone: true }),
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('forma_pagamento_canal_unique').on(t.filialId, t.formaPagamento),
    filialIdx: index('forma_pagamento_canal_filial_idx').on(t.filialId),
    canalIdx: index('forma_pagamento_canal_canal_idx').on(t.filialId, t.canal),
  }),
);

/**
 * Match persistido entre pagamento PDV (canal=ADQUIRENTE) e venda_adquirente
 * (Cielo). 1:1, com nivel da cascata e flag de auto-revogavel.
 *
 * Nivel:
 *  1 = NSU + Autorizacao batem (chave forte, max confianca)
 *  2 = Apenas NSU bate, candidato unico (alta confianca)
 *  3 = Data exata + Valor exato + categoria forma (alta confianca)
 *  4 = Data exata + Valor dentro de tolerancia (vira divergencia, nao match silencioso)
 *  5 = Data +-1 dia util + Valor exato (auto-revogavel: pode quebrar quando
 *      aparecer evidencia mais forte numa rodada futura)
 *
 * Persistir matches resolve o nao-determinismo: proxima rodada filtra os ja
 * casados e nao reembaralha. Matches manuais (criadoPor != 'AUTO') nunca
 * sao auto-revogados.
 */
export const matchPdvCielo = pgTable(
  'match_pdv_cielo',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    pagamentoId: uuid('pagamento_id')
      .notNull()
      .references(() => pagamento.id, { onDelete: 'cascade' })
      .unique(),
    /** FK pra venda_adquirente — sem reference cruzada pra evitar circular. */
    vendaAdquirenteId: uuid('venda_adquirente_id').notNull().unique(),
    /** 1-5 (vide doc da tabela) */
    nivelMatch: numeric('nivel_match', { precision: 2, scale: 0 }).notNull(),
    /** True quando match nivel 4-5 (proximidade). Pode ser auto-quebrado quando
     *  aparecer evidencia mais forte (NSU bate em outro par na rodada seguinte). */
    autoRevogavel: timestamp('auto_revogavel_ate', { withTimezone: true }),
    /** 'AUTO' ou user_id (uuid em string). Manual NUNCA e auto-revogado. */
    criadoPor: varchar('criado_por', { length: 50 }).notNull().default('AUTO'),
    /** Diff de valor em R$ entre PDV e Cielo no momento do match (positivo = Cielo > PDV) */
    diffValor: numeric('diff_valor', { precision: 14, scale: 2 }),
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialIdx: index('match_pdv_cielo_filial_idx').on(t.filialId),
    revogaveisIdx: index('match_pdv_cielo_revogaveis_idx')
      .on(t.filialId)
      .where(sql`auto_revogavel_ate IS NOT NULL`),
  }),
);

/**
 * Match persistido entre pagamento PDV (canal=DIRETO) e lancamento_banco
 * (crédito direto na conta — Pix Manual, TED, DOC). 1:1, com origem do
 * match (auto vs manual) pra garantir que rodadas seguintes do engine
 * nao reembaralhem decisoes ja tomadas.
 *
 * Vs match cielo: aqui nao tem NSU pra conferir, entao matches AUTO de
 * niveis 2+ ficam marcados como auto_revogavel — quando aparece
 * evidencia mais forte (ex: E2E ID na fase 2), o auto-revogavel pode
 * quebrar e o forte assume.
 */
export const matchPdvBanco = pgTable(
  'match_pdv_banco',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    pagamentoId: uuid('pagamento_id')
      .notNull()
      .references(() => pagamento.id, { onDelete: 'cascade' })
      .unique(),
    /** FK pra lancamento_banco. Sem reference cruzada pra evitar circular. */
    lancamentoBancoId: uuid('lancamento_banco_id').notNull().unique(),
    /** 1 = data D ou D±1 + valor exato; 2 = data ±2d uteis + valor exato */
    nivelMatch: numeric('nivel_match', { precision: 2, scale: 0 }).notNull(),
    /** 'AUTO' ou user_id (uuid em string) */
    criadoPor: varchar('criado_por', { length: 50 }).notNull().default('AUTO'),
    /** True quando match foi por proximidade (nivel 2+) e pode ser
     *  desfeito quando aparecer evidencia mais forte */
    autoRevogavel: timestamp('auto_revogavel_ate', { withTimezone: true }),
    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialIdx: index('match_pdv_banco_filial_idx').on(t.filialId),
  }),
);

/**
 * Sugestao de match cross-route: quando o garcom registrou Pix Online
 * (canal ADQUIRENTE) mas o pagamento na verdade caiu como PIX direto no
 * banco (canal DIRETO seria o correto), ou vice-versa.
 *
 * Geradas pelo engine cross-route. **Nunca viram match silencioso** — o
 * usuario precisa aceitar manualmente. Isso preserva visibilidade do erro
 * de cadastro do garcom (input pra retreinamento).
 *
 * Sugestao tem 1 pagamento e 1 contraparte (banco OU cielo, nunca os dois).
 */
export const sugestaoCrossRoute = pgTable(
  'sugestao_cross_route',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    pagamentoId: uuid('pagamento_id')
      .notNull()
      .references(() => pagamento.id, { onDelete: 'cascade' })
      .unique(),
    /** PDV_ADQUIRENTE_PARA_BANCO (canal=ADQUIRENTE pode ser DIRETO)
     *  | PDV_DIRETO_PARA_CIELO   (canal=DIRETO pode ser ADQUIRENTE) */
    tipo: varchar('tipo', { length: 30 }).notNull(),
    /** FK pra lancamento_banco, set quando tipo=PDV_ADQUIRENTE_PARA_BANCO */
    lancamentoBancoId: uuid('lancamento_banco_id'),
    /** FK pra venda_adquirente, set quando tipo=PDV_DIRETO_PARA_CIELO */
    vendaAdquirenteId: uuid('venda_adquirente_id'),
    /** 1=alta confianca (data exata + valor exato), 2=media (data ±1d) */
    score: numeric('score', { precision: 2, scale: 0 }).notNull(),
    /** texto explicando como casou (ex: "Mesma data e valor exato") */
    motivo: text('motivo'),
    /** Quando o user rejeitou. Null = aberta. */
    rejeitadoEm: timestamp('rejeitado_em', { withTimezone: true }),
    rejeitadoPor: uuid('rejeitado_por'),
    /** Quando o user aceitou (vira match real e sugestao some). */
    aceitoEm: timestamp('aceito_em', { withTimezone: true }),
    aceitoPor: uuid('aceito_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialIdx: index('sugestao_cross_route_filial_idx').on(t.filialId),
    abertasIdx: index('sugestao_cross_route_abertas_idx').on(t.filialId)
      .where(sql`aceito_em IS NULL AND rejeitado_em IS NULL`),
  }),
);

/**
 * Cada execucao do job de conciliacao gera um relatorio.
 */
export const execucaoConciliacao = pgTable('execucao_conciliacao', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  filialId: uuid('filial_id')
    .notNull()
    .references(() => filial.id, { onDelete: 'cascade' }),
  /** OPERADORA | BANCO | legado: null = trace antigo */
  processo: varchar('processo', { length: 20 }),
  /** periodo que foi conciliado */
  dataInicio: timestamp('data_inicio', { withTimezone: true }),
  dataFim: timestamp('data_fim', { withTimezone: true }),
  iniciadoEm: timestamp('iniciado_em', { withTimezone: true }).notNull().defaultNow(),
  finalizadoEm: timestamp('finalizado_em', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull().default('EM_ANDAMENTO'),
  resumo: jsonb('resumo').$type<Record<string, unknown>>(),
  erro: text('erro'),
});
