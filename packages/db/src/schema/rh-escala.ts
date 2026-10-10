// Histórico do ponto antigo (Stelanto) + jornada (escala) + banco de horas.
//
// As casas bateram ponto no Stelanto de 12/2023 até a virada pro ponto facial
// próprio (lib/rh/ponto-vigencia.ts). Em 10/10/2026 o histórico inteiro foi
// trazido pra cá: `stelanto_colaborador` (todo mundo que já passou por lá,
// ativo ou desligado) e `stelanto_dia` (um dia por linha, com as batidas).
// É ARQUIVO: nada aqui alimenta folha nem `ponto_batida` — serve pra consulta
// e pra análise de escala. O vínculo com `funcionario` é por CPF e pode ser
// nulo (desligado antigo que nunca teve cadastro no Concilia).
//
// `rh_jornada` é a escala (minutos previstos por dia da semana, 0 = folga) e
// `funcionario_jornada` diz qual jornada cada pessoa cumpre desde quando.
// `banco_horas_lancamento` guarda o saldo que veio do Stelanto na virada
// (tipo 'saldo_inicial') e os acertos manuais; o movimento do dia a dia
// depois da virada NÃO é gravado — é calculado na tela (ponto × jornada).

import {
  pgTable,
  uuid,
  varchar,
  integer,
  date,
  timestamp,
  boolean,
  text,
  unique,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { filial } from './tenant';
import { funcionario } from './rh';

export const stelantoColaborador = pgTable(
  'stelanto_colaborador',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Id do usuário no Stelanto (uuid do login) — chave do reimporte. */
    stelantoUserId: varchar('stelanto_user_id', { length: 40 }).notNull(),
    /** NULL = nunca teve cadastro no Concilia (desligado antigo). */
    funcionarioId: uuid('funcionario_id').references(() => funcionario.id, { onDelete: 'set null' }),
    /** Casa pela equipe do Stelanto (PRAINHA → Bar, TABUARA, PRAINHA MAR). */
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'set null' }),
    nome: varchar('nome', { length: 200 }).notNull(),
    /** Só dígitos. */
    cpf: varchar('cpf', { length: 11 }),
    email: varchar('email', { length: 200 }),
    telefone: varchar('telefone', { length: 30 }),
    dataNascimento: date('data_nascimento'),
    dataAdmissao: date('data_admissao'),
    dataDesligamento: date('data_desligamento'),
    /** ACTIVE | DISABLED (como estava no Stelanto no dia do importe). */
    status: varchar('status', { length: 20 }).notNull(),
    equipe: varchar('equipe', { length: 80 }),
    unidade: varchar('unidade', { length: 80 }),
    /** Nome da jornada no Stelanto no dia do importe. */
    jornada: varchar('jornada', { length: 120 }),
    diasTrabalhados: integer('dias_trabalhados').notNull().default(0),
    primeiroDia: date('primeiro_dia'),
    ultimoDia: date('ultimo_dia'),
    importadoEm: timestamp('importado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_stelanto_colaborador_user').on(t.stelantoUserId),
    porFuncionario: index('idx_stelanto_colaborador_funcionario').on(t.funcionarioId),
    porFilial: index('idx_stelanto_colaborador_filial').on(t.filialId),
  }),
);

/** Um dia de uma pessoa no Stelanto. Tempos em SEGUNDOS, como vieram de lá. */
export const stelantoDia = pgTable(
  'stelanto_dia',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    colaboradorId: uuid('colaborador_id').notNull().references(() => stelantoColaborador.id, { onDelete: 'cascade' }),
    dia: date('dia').notNull(),
    /** OK | REST_DAY | HOLIDAY | NO_TIME_ENTRIES | VACATION | DAY_OFF | ... */
    status: varchar('status', { length: 30 }),
    jornada: varchar('jornada', { length: 120 }),
    previstoSeg: integer('previsto_seg').notNull().default(0),
    trabalhadoSeg: integer('trabalhado_seg').notNull().default(0),
    intervaloSeg: integer('intervalo_seg').notNull().default(0),
    faltaSeg: integer('falta_seg').notNull().default(0),
    extraSeg: integer('extra_seg').notNull().default(0),
    noturnoSeg: integer('noturno_seg').notNull().default(0),
    /** Quanto o dia somou/tirou do banco de horas. */
    saldoDiaSeg: integer('saldo_dia_seg').notNull().default(0),
    /** Saldo acumulado do banco naquele dia. */
    saldoAcumuladoSeg: integer('saldo_acumulado_seg').notNull().default(0),
    /** [{ h:'07:30', t:'E'|'S', disp, reg, ed, lat, lng }] */
    batidas: jsonb('batidas'),
    /** Pedido aprovado do dia (ajuste, folga, férias, abono): { t, s, d, md, at } */
    pedido: jsonb('pedido'),
    /** Campos raros do Stelanto (hora extra 50/100, noturno ficto...). */
    outros: jsonb('outros'),
  },
  (t) => ({
    uniq: unique('uq_stelanto_dia').on(t.colaboradorId, t.dia),
    porDia: index('idx_stelanto_dia_dia').on(t.dia),
  }),
);

export const rhJornada = pgTable(
  'rh_jornada',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    nome: varchar('nome', { length: 120 }).notNull(),
    /** fixa (conta banco de horas) | intermitente (só horas trabalhadas) */
    tipo: varchar('tipo', { length: 20 }).notNull().default('fixa'),
    /** Minutos previstos por dia da semana; 0 = folga. */
    minSeg: integer('min_seg').notNull().default(0),
    minTer: integer('min_ter').notNull().default(0),
    minQua: integer('min_qua').notNull().default(0),
    minQui: integer('min_qui').notNull().default(0),
    minSex: integer('min_sex').notNull().default(0),
    minSab: integer('min_sab').notNull().default(0),
    minDom: integer('min_dom').notNull().default(0),
    /** stelanto | manual */
    origem: varchar('origem', { length: 20 }).notNull().default('manual'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: unique('uq_rh_jornada_nome').on(t.nome) }),
);

/** Jornada que a pessoa cumpre a partir de `vigenteDesde` (vale a mais
 *  recente com data <= o dia). Trocar de escala = linha nova, sem apagar. */
export const funcionarioJornada = pgTable(
  'funcionario_jornada',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    jornadaId: uuid('jornada_id').notNull().references(() => rhJornada.id, { onDelete: 'restrict' }),
    vigenteDesde: date('vigente_desde').notNull(),
    usuarioId: uuid('usuario_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: unique('uq_funcionario_jornada').on(t.funcionarioId, t.vigenteDesde) }),
);

export const bancoHorasLancamento = pgTable(
  'banco_horas_lancamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    dia: date('dia').notNull(),
    /** Com sinal: positivo = a casa deve hora, negativo = a pessoa deve. */
    minutos: integer('minutos').notNull(),
    /** saldo_inicial | ajuste | pagamento | folga */
    tipo: varchar('tipo', { length: 20 }).notNull(),
    /** stelanto | manual */
    origem: varchar('origem', { length: 20 }).notNull().default('manual'),
    descricao: text('descricao'),
    usuarioId: uuid('usuario_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ porPessoa: index('idx_banco_horas_pessoa').on(t.funcionarioId, t.dia) }),
);
