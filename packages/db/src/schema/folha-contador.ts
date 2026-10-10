// Folha do contador — o "Extrato Mensal" que o escritório de contabilidade
// manda todo mês (um PDF por empresa/departamento). É a folha REGISTRADA
// (carteira), diferente da folha semanal da casa (schema/folha.ts: diárias,
// rateio dos 10%, bônus).
//
// `folha_contador` tem uma linha por pessoa por competência, do jeito que
// veio no PDF: vínculo, cargo da carteira, CBO, salário, rubricas, bases e
// o líquido. `folha_contador_resumo` guarda o fechamento do PDF (nº de
// empregados, totais e os encargos da empresa), que só existe por
// empresa/departamento.
//
// É REGISTRO do que o contador calculou: nada aqui gera conta a pagar nem
// entra no cálculo da folha semanal. Entra pelo script
// `importar:folha-contador` (packages/db/scripts), que confere cada PDF com
// o próprio resumo antes de gravar. O vínculo com `funcionario` é por CPF e
// pode ser nulo (pessoa que só existe na folha).
//
// Empresas que registram hoje: E.B. SERVICOS LTDA (um departamento por
// casa), PRAINHA TURISMO LTDA (os antigos do Bar) e LELIS ATACADISTA.
// `filial_id` é a casa do DEPARTAMENTO da folha — pode ser diferente da
// lotação do cadastro (quem está registrado numa casa e trabalha em outra).

import {
  pgTable,
  uuid,
  varchar,
  integer,
  date,
  timestamp,
  numeric,
  unique,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { filial } from './tenant';
import { funcionario } from './rh';

/** Uma linha do holerite: provento (P) ou desconto (D). */
export interface RubricaFolhaContador {
  codigo: string;
  descricao: string;
  /** Referência do contador: horas, dias ou percentual, conforme a rubrica. */
  referencia: number;
  valor: number;
  tipo: 'P' | 'D';
}

export const folhaContador = pgTable(
  'folha_contador',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Casa do departamento da folha (não a lotação do cadastro). */
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'restrict' }),
    funcionarioId: uuid('funcionario_id').references(() => funcionario.id, { onDelete: 'set null' }),
    /** 'AAAA-MM'. */
    competencia: varchar('competencia', { length: 7 }).notNull(),

    empresa: varchar('empresa', { length: 120 }).notNull(),
    /** Só dígitos. */
    cnpj: varchar('cnpj', { length: 14 }).notNull(),
    departamento: varchar('departamento', { length: 80 }),
    /** Código do empregado na folha do contador — único dentro da empresa. */
    matricula: varchar('matricula', { length: 20 }).notNull(),

    nome: varchar('nome', { length: 200 }).notNull(),
    cpf: varchar('cpf', { length: 11 }),
    /** 'Trabalhando' | 'Demitido' | 'Férias' | ... como veio no PDF. */
    situacao: varchar('situacao', { length: 60 }),
    /** 'Celetista' | 'Celetista Contrato Intermitente'. */
    vinculo: varchar('vinculo', { length: 60 }),
    cargo: varchar('cargo', { length: 80 }),
    cbo: varchar('cbo', { length: 10 }),
    dataAdmissao: date('data_admissao'),
    horasMes: numeric('horas_mes', { precision: 7, scale: 2 }),
    /** R$/mês no celetista; R$/HORA no intermitente. */
    salario: numeric('salario', { precision: 10, scale: 2 }),

    proventos: numeric('proventos', { precision: 12, scale: 2 }).notNull().default('0'),
    descontos: numeric('descontos', { precision: 12, scale: 2 }).notNull().default('0'),
    liquido: numeric('liquido', { precision: 12, scale: 2 }).notNull().default('0'),
    baseInss: numeric('base_inss', { precision: 12, scale: 2 }),
    baseFgts: numeric('base_fgts', { precision: 12, scale: 2 }),
    valorFgts: numeric('valor_fgts', { precision: 12, scale: 2 }),
    baseIrrf: numeric('base_irrf', { precision: 12, scale: 2 }),

    demitidoEm: date('demitido_em'),
    motivoDemissao: varchar('motivo_demissao', { length: 200 }),

    rubricas: jsonb('rubricas').$type<RubricaFolhaContador[]>().notNull().default(sql`'[]'::jsonb`),

    /** Nome do PDF de onde veio. */
    arquivo: varchar('arquivo', { length: 200 }),
    importadoEm: timestamp('importado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_folha_contador').on(t.cnpj, t.competencia, t.matricula),
    filialCompIdx: index('idx_folha_contador_filial_comp').on(t.filialId, t.competencia),
    funcionarioIdx: index('idx_folha_contador_funcionario').on(t.funcionarioId),
  }),
);

export const folhaContadorResumo = pgTable(
  'folha_contador_resumo',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'restrict' }),
    competencia: varchar('competencia', { length: 7 }).notNull(),
    empresa: varchar('empresa', { length: 120 }).notNull(),
    cnpj: varchar('cnpj', { length: 14 }).notNull(),
    /** '' quando o PDF é da empresa inteira (sem departamento). */
    departamento: varchar('departamento', { length: 80 }).notNull().default(''),

    empregados: integer('empregados').notNull().default(0),
    trabalhando: integer('trabalhando').notNull().default(0),
    demitidos: integer('demitidos').notNull().default(0),

    proventos: numeric('proventos', { precision: 12, scale: 2 }).notNull().default('0'),
    descontos: numeric('descontos', { precision: 12, scale: 2 }).notNull().default('0'),
    liquido: numeric('liquido', { precision: 12, scale: 2 }).notNull().default('0'),

    /** INSS descontado dos empregados. */
    inssSegurados: numeric('inss_segurados', { precision: 12, scale: 2 }).notNull().default('0'),
    /** Parte da empresa (patronal), RAT e terceiros — zero em empresa do Simples. */
    inssEmpresa: numeric('inss_empresa', { precision: 12, scale: 2 }).notNull().default('0'),
    inssRat: numeric('inss_rat', { precision: 12, scale: 2 }).notNull().default('0'),
    inssTerceiros: numeric('inss_terceiros', { precision: 12, scale: 2 }).notNull().default('0'),
    fgts: numeric('fgts', { precision: 12, scale: 2 }).notNull().default('0'),
    fgtsRescisorio: numeric('fgts_rescisorio', { precision: 12, scale: 2 }).notNull().default('0'),
    irrf: numeric('irrf', { precision: 12, scale: 2 }).notNull().default('0'),

    arquivo: varchar('arquivo', { length: 200 }),
    importadoEm: timestamp('importado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_folha_contador_resumo').on(t.cnpj, t.competencia, t.departamento),
    filialCompIdx: index('idx_folha_contador_resumo_filial_comp').on(t.filialId, t.competencia),
  }),
);
