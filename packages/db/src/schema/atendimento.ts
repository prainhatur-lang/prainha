// Atendimento WhatsApp (Nina) — conversas com clientes no numero da Cloud API.
//
// Modelo:
//   whatsapp_numero      numero Meta -> filial (a Nina pode morar em N numeros)
//   atendimento_conversa 1 por contato+filial; status controla quem responde
//   atendimento_mensagem transcript completo (entrada e saida)
//   atendimento_config   1 por filial: persona, conhecimento, espacos, equipe
//   evento_lead          pedidos de orcamento de evento coletados pela Nina
//
// Spec: docs/superpowers/specs/2026-08-08-atendente-whatsapp-design.md

import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  date,
  timestamp,
  jsonb,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/** Bloco editavel da base de conhecimento da Nina. */
export interface BlocoConhecimento {
  id: string;
  titulo: string;
  conteudo: string;
}

/** Espaco alugavel pra evento (gramado, terraco, varandinha...). */
export interface EspacoEvento {
  id: string;
  nome: string;
  capacidade: string; // texto livre: "ate 50 sentadas"
  descricao: string;
  /** Preco/condicoes em texto livre. Vazio = Nina diz que a equipe confirma o valor. */
  preco: string;
  condicoes: string;
  ativo: boolean;
}

export const whatsappNumero = pgTable('whatsapp_numero', {
  /** phone_number_id da Meta (chega no webhook em value.metadata). */
  phoneNumberId: text('phone_number_id').primaryKey(),
  filialId: uuid('filial_id')
    .notNull()
    .references(() => filial.id, { onDelete: 'cascade' }),
  /** So exibicao no painel (ex: 5579999998888). */
  numeroExibicao: varchar('numero_exibicao', { length: 20 }),
  /** false = webhook ignora mensagens de texto desse numero (so botoes). */
  atendenteAtivo: boolean('atendente_ativo').notNull().default(false),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const atendimentoConversa = pgTable(
  'atendimento_conversa',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** So digitos com DDI (ex: 5579999724554). */
    telefone: varchar('telefone', { length: 20 }).notNull(),
    /** Nome do profile do WhatsApp (value.contacts[].profile.name). */
    nomeCliente: varchar('nome_cliente', { length: 200 }),
    /** bot = Nina responde · humano = equipe assumiu · fornecedor = guard
     *  (numero tambem fala com fornecedores; Nina nao responde) ·
     *  encerrada = arquivada (reabre como bot se o cliente voltar). */
    status: varchar('status', { length: 20 }).notNull().default('bot'),
    motivoTransferencia: text('motivo_transferencia'),
    /** Ultima mensagem RECEBIDA do cliente — controla a janela de 24h. */
    ultimaMsgClienteEm: timestamp('ultima_msg_cliente_em', { withTimezone: true }),
    ultimaMsgEm: timestamp('ultima_msg_em', { withTimezone: true }),
    naoLidas: integer('nao_lidas').notNull().default(0),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqFilialFone: unique('uq_atend_conversa_filial_fone').on(t.filialId, t.telefone),
    ultimaIdx: index('idx_atend_conversa_ultima').on(t.filialId, t.ultimaMsgEm),
  }),
);

export const atendimentoMensagem = pgTable(
  'atendimento_mensagem',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    conversaId: uuid('conversa_id')
      .notNull()
      .references(() => atendimentoConversa.id, { onDelete: 'cascade' }),
    /** Id da Meta. Unique = dedupe de reentrega do webhook. Null em saidas
     *  que falharam antes do envio. */
    waMessageId: text('wa_message_id').unique(),
    direcao: varchar('direcao', { length: 10 }).notNull(), // entrada | saida
    autor: varchar('autor', { length: 12 }).notNull(), // cliente | bot | equipe | sistema
    autorUsuarioId: uuid('autor_usuario_id'),
    tipo: varchar('tipo', { length: 20 }).notNull().default('texto'), // texto|audio|imagem|video|documento|botao|outro
    /** Texto da mensagem; em audio, a transcricao. */
    corpo: text('corpo'),
    mediaId: text('media_id'),
    statusEnvio: varchar('status_envio', { length: 20 }), // pendente|enviada|entregue|lida|erro (so saidas)
    erro: text('erro'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    conversaIdx: index('idx_atend_msg_conversa').on(t.conversaId, t.criadoEm),
  }),
);

export const atendimentoConfig = pgTable('atendimento_config', {
  filialId: uuid('filial_id')
    .primaryKey()
    .references(() => filial.id, { onDelete: 'cascade' }),
  /** Chave geral: false = Nina nao responde nessa filial. */
  ativo: boolean('ativo').notNull().default(false),
  nomeAtendente: varchar('nome_atendente', { length: 50 }).notNull().default('Nina'),
  /** Perfil comportamental editavel (tom, jeito) — vai no system prompt. */
  persona: text('persona'),
  conhecimento: jsonb('conhecimento').$type<BlocoConhecimento[]>(),
  espacosEvento: jsonb('espacos_evento').$type<EspacoEvento[]>(),
  /** Telefones (digitos com DDI) que recebem avisos de transferencia/lead. */
  numerosEquipe: jsonb('numeros_equipe').$type<string[]>(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const eventoLead = pgTable(
  'evento_lead',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    conversaId: uuid('conversa_id').references(() => atendimentoConversa.id, {
      onDelete: 'set null',
    }),
    nome: varchar('nome', { length: 200 }),
    telefone: varchar('telefone', { length: 20 }),
    tipoEvento: varchar('tipo_evento', { length: 100 }),
    dataEvento: date('data_evento'),
    hora: varchar('hora', { length: 5 }),
    pessoas: integer('pessoas'),
    espaco: varchar('espaco', { length: 100 }),
    observacoes: text('observacoes'),
    status: varchar('status', { length: 20 }).notNull().default('novo'), // novo|em_contato|fechado|perdido
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialIdx: index('idx_evento_lead_filial').on(t.filialId, t.status),
  }),
);
