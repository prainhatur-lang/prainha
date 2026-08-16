// Banco de talentos (regra do Elison, 16/08): quem fala com a Nina sobre
// trabalhar na casa recebe o link /trabalhe — cadastro por CPF (puxa o que
// já sabemos do cliente), funções que sabe exercer (multi) e contato
// atualizado. A equipe garimpa aqui quando abre vaga.

import { pgTable, uuid, text, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Funções de restaurante que o candidato pode marcar (multi-escolha). */
export const FUNCOES_TALENTO = [
  'Cozinheiro(a)',
  'Auxiliar de cozinha',
  'Chapeiro(a)',
  'Garçom / Garçonete',
  'Cumim',
  'Bartender',
  'Caixa',
  'Recepcionista',
  'Limpeza',
  'Segurança',
  'Manobrista',
  'Outra',
] as const;

export const talento = pgTable(
  'talento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** CPF só dígitos — chave natural do cadastro (recadastro atualiza). */
    cpf: varchar('cpf', { length: 11 }).notNull().unique(),
    nome: varchar('nome', { length: 200 }).notNull(),
    /** WhatsApp com DDI/DDD, só dígitos. */
    whatsapp: varchar('whatsapp', { length: 20 }).notNull(),
    endereco: text('endereco'),
    /** Funções desejadas (valores de FUNCOES_TALENTO). */
    funcoes: jsonb('funcoes').$type<string[]>().notNull(),
    /** "O que você sabe fazer?" — experiência em texto livre. */
    experiencia: text('experiencia'),
    /** novo | avaliado | chamado | contratado | descartado */
    status: varchar('status', { length: 20 }).notNull().default('novo'),
    origem: varchar('origem', { length: 30 }).notNull().default('nina-whatsapp'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('idx_talento_status').on(t.status),
  }),
);
