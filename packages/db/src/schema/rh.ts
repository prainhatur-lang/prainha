// Cadastro único de funcionário + ponto próprio.
//
// Antes desta tabela havia quatro cadastros de pessoa desconexos:
// `fornecedor`+`fornecedor_folha` (quem recebe folha), `colaborador`
// (cozinheiros, com token de painel), `talento` (candidatos) e
// `usuario_operacao` (login do caixa/comanda/KDS). `funcionario` é o HUB
// novo — referencia os quatro por FK nullable, sem tocar em nenhum deles:
// todos continuam sendo escritos automaticamente por caminhos que já
// existem (sync do Consumer, autocomplete de OP, promoção de talento,
// criação de login local), e uma FK neles ficaria vazia na maioria das
// linhas ou colidiria com esses fluxos.
//
// Ponto: bate na loja (vendas-local) por RECONHECIMENTO FACIAL — botão no
// KDS abre a câmera, compara com os descritores cadastrados (100% no
// navegador, nunca manda foto pra rede) e registra sozinho. Sem PIN: quem
// bate ponto pode não vender nada (ajudante de cozinha), e o tablet da
// porta é compartilhado — a pessoa só toca o próprio nome na primeira vez
// (quando ainda não há descritor dela pra comparar), nunca mais depois.
// `ponto_batida` é append-only; correção manual sempre passa por
// `ponto_batida_ajuste` (justificativa obrigatória). `ponto_dia` é cache
// derivado, sempre reconstruível a partir de `ponto_batida` — nunca fonte
// de verdade.
//
// O total calculado alimenta `folha_horas.origem = 'ponto_proprio'`,
// convivendo com `espelho` (upload manual, ainda ativo durante a transição)
// e `manual` (correção humana, que nunca é sobrescrita — ver
// lib/rh/projetar-horas.ts).

import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  date,
  timestamp,
  boolean,
  text,
  unique,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { filial, usuarioOperacao } from './tenant';
import { fornecedor } from './financeiro';
import { colaborador } from './estoque';
import { talento } from './talento';

export const funcionario = pgTable(
  'funcionario',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Lotação principal. Quem trabalha nas duas casas tem 1 linha aqui — o
     *  vínculo de horas por casa se resolve em lib/rh/projetar-horas.ts. */
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'restrict' }),

    /** Só dígitos. Único quando preenchido (UNIQUE padrão do Postgres não
     *  compara NULL com NULL — vários funcionários sem CPF convivem). NULL
     *  na transição: quem veio de `colaborador` não tinha CPF cadastrado. */
    cpf: varchar('cpf', { length: 11 }),
    nome: varchar('nome', { length: 200 }).notNull(),
    dataNascimento: date('data_nascimento'),
    telefone: varchar('telefone', { length: 20 }),
    endereco: text('endereco'),
    /** Path no Supabase Storage (bucket rh-fotos). NULL = sem foto. */
    fotoPath: text('foto_path'),
    /** Descritor facial (128 floats, face-api.js) pro ponto por reconhecimento
     *  — nunca a foto em si, só a "impressão" numérica. Cadastrado sozinho na
     *  loja na primeira vez que a pessoa aparece na câmera do ponto. */
    faceDescriptor: jsonb('face_descriptor'),

    /** Valor de FUNCOES_TALENTO (schema/talento.ts). */
    cargo: varchar('cargo', { length: 60 }),
    /** COZINHA | SALAO | PRODUCAO | ADM — vocabulário de colaborador.tipo. */
    setor: varchar('setor', { length: 20 }),
    dataAdmissao: date('data_admissao'),
    dataDesligamento: date('data_desligamento'),
    motivoDesligamento: varchar('motivo_desligamento', { length: 200 }),
    ativo: boolean('ativo').notNull().default(true),

    /** Login do Consumer/usuario_operacao, quando a pessoa também vende —
     *  usado como fallback de PIN no bater ponto (ver PONTO_HTML). */
    loginLocal: varchar('login_local', { length: 60 }),

    /** Quem paga (fornecedor segue dono de nome/CPF pra quem tem vínculo —
     *  write-back pro Consumer continua em folha-equipe/pessoas). */
    fornecedorId: uuid('fornecedor_id').references(() => fornecedor.id, { onDelete: 'set null' }),
    /** Quem tem token de painel /cozinheiro/[token]. */
    colaboradorId: uuid('colaborador_id').references(() => colaborador.id, { onDelete: 'set null' }),
    /** De onde veio no funil de contratação (rastreio, opcional). */
    talentoId: uuid('talento_id').references(() => talento.id, { onDelete: 'set null' }),
    /** Login de caixa/comanda/KDS, quando existir. */
    usuarioOperacaoId: uuid('usuario_operacao_id').references(() => usuarioOperacao.id, { onDelete: 'set null' }),

    /** true = backfill criou sem CPF ou com match fraco de nome — aparece
     *  na worklist "Revisar cadastro" de /rh/funcionarios. */
    precisaRevisao: boolean('precisa_revisao').notNull().default(false),
    observacao: text('observacao'),

    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCpf: unique('uq_funcionario_cpf').on(t.cpf),
    uniqFornecedor: unique('uq_funcionario_fornecedor').on(t.fornecedorId),
    uniqColaborador: unique('uq_funcionario_colaborador').on(t.colaboradorId),
    uniqUsuarioOperacao: unique('uq_funcionario_usuario_operacao').on(t.usuarioOperacaoId),
    filialAtivoIdx: index('idx_funcionario_filial_ativo').on(t.filialId, t.ativo),
    nomeIdx: index('idx_funcionario_nome').on(t.nome),
  }),
);

/** Filial ADICIONAL de quem circula entre lojas (ex: segunda na Prainha Bar,
 *  terça na Prainha Mar) — `funcionario.filialId` continua sendo a lotação
 *  principal (dona do cadastro pra fins de folha/relatório); esta tabela só
 *  soma onde a pessoa TAMBÉM aparece no roster de ponto. Uma pessoa, um
 *  rosto — nunca duplica o cadastro por loja. */
export const funcionarioFilialExtra = pgTable(
  'funcionario_filial_extra',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_funcionario_filial_extra').on(t.funcionarioId, t.filialId),
    filialIdx: index('idx_funcionario_filial_extra_filial').on(t.filialId),
  }),
);

/** Uma batida. APPEND-ONLY — toda mudança gera linha em
 *  ponto_batida_ajuste; exclusão é soft (excluida_em/excluida_por). */
export const pontoBatida = pgTable(
  'ponto_batida',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    /** Instante real da batida. */
    quando: timestamp('quando', { withTimezone: true }).notNull(),
    /** Dia contábil BRT com virada configurável (default 05:00) — o bar
     *  fecha de madrugada, então uma batida de sábado 02h30 é de SEXTA. */
    diaOperacional: date('dia_operacional').notNull(),
    /** entrada | saida */
    tipo: varchar('tipo', { length: 10 }).notNull(),
    /** vendas_local | web | correcao */
    origem: varchar('origem', { length: 20 }).notNull().default('vendas_local'),
    /** id da linha na tabela local da loja — dedupe de reenvio. NULL em
     *  batidas criadas por correção manual na nuvem. */
    idLocal: bigint('id_local', { mode: 'number' }),
    dispositivo: varchar('dispositivo', { length: 120 }),
    loginLocal: varchar('login_local', { length: 60 }),
    excluidaEm: timestamp('excluida_em', { withTimezone: true }),
    excluidaPor: uuid('excluida_por'),
    recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Reenvio do lote da loja não duplica (mesma régua de cancelamento_item). */
    uniqLoja: unique('uq_ponto_batida_filial_local').on(t.filialId, t.idLocal),
    porDia: index('idx_ponto_batida_dia').on(t.filialId, t.diaOperacional),
    porPessoa: index('idx_ponto_batida_pessoa').on(t.funcionarioId, t.diaOperacional),
  }),
);

/** Trilha de auditoria: 1 linha por inclusão/alteração/exclusão manual.
 *  justificativa é NOT NULL de propósito — RH sempre vai precisar disso. */
export const pontoBatidaAjuste = pgTable(
  'ponto_batida_ajuste',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    /** NULL quando acao='inclusao' e a batida ainda não existia. */
    batidaId: uuid('batida_id').references(() => pontoBatida.id, { onDelete: 'set null' }),
    dia: date('dia').notNull(),
    /** inclusao | alteracao | exclusao */
    acao: varchar('acao', { length: 12 }).notNull(),
    valorAntes: jsonb('valor_antes'),
    valorDepois: jsonb('valor_depois'),
    justificativa: text('justificativa').notNull(),
    usuarioId: uuid('usuario_id').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ porDia: index('idx_ponto_ajuste_dia').on(t.filialId, t.dia) }),
);

/** Rollup DERIVADO do dia — cache reconstruível a partir de ponto_batida,
 *  nunca fonte de verdade. Existe pra a tela de gestão ler rápido e pra a
 *  projeção em folha_horas ser um passo idempotente e re-executável. */
export const pontoDia = pgTable(
  'ponto_dia',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    dia: date('dia').notNull(),
    totalMin: integer('total_min').notNull().default(0),
    /** ok | incompleto (bateu entrada sem saída) | ajustado */
    status: varchar('status', { length: 12 }).notNull().default('ok'),
    /** [{ entrada, saida, min }] — pares fechados, pro tooltip da tela. */
    pares: jsonb('pares'),
    calculadoEm: timestamp('calculado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: unique('uq_ponto_dia').on(t.filialId, t.funcionarioId, t.dia) }),
);
