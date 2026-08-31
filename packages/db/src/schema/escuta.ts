// Clima organizacional (eNPS) e ouvidoria anônima — Fase 2 do RH.
//
// ═══════════════════════════════════════════════════════════════════════
// CONTRATO DE ANONIMATO — leia antes de adicionar qualquer coluna aqui.
// ═══════════════════════════════════════════════════════════════════════
// RLS neste projeto é só ENABLE (nunca FORCE) — barra a anon key do
// PostgREST, mas o backend (role postgres, rolbypassrls=true) e qualquer
// acesso direto ao banco leem TUDO, sempre. Anonimato real só existe se o
// identificador NUNCA for gravado — é decisão de schema, não de permissão.
//
// NUNCA adicionar nestas tabelas:
//  - FK de remetente (funcionário, usuário, cliente)
//  - IP, user-agent, device-id (rate-limit disfarçado É desanonimização)
//  - nome, telefone, e-mail
//  - anexo/foto (carrega EXIF — geolocalização, modelo do aparelho)
//  - timestamp com HORA — este banco já tem ponto_batida (Fase 1). Um
//    timestamptz de minuto aqui vira join direto com "quem estava batendo
//    ponto àquela hora naquela filial". Por isso as colunas de data abaixo
//    são `date` (dia), nunca `timestamp`.
//
// Campos de TRIAGEM (status, observação interna, quem leu/resolveu) são
// seguros — são sobre a MENSAGEM, não sobre quem mandou.

import { pgTable, uuid, varchar, text, date, integer, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const ouvidoriaMensagem = pgTable(
  'ouvidoria_mensagem',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    categoria: varchar('categoria', { length: 20 }).notNull(), // assedio|seguranca|gestao|condicoes|sugestao|outro
    mensagem: text('mensagem').notNull(),
    recebidaEm: date('recebida_em').notNull(),

    /** nova | lida | em_apuracao | resolvida | descartada. Sem DELETE — o
     *  botão "excluir" numa denúncia de assédio é o botão que um gestor
     *  comprometido usaria; descarte é status='descartada'. */
    status: varchar('status', { length: 20 }).notNull().default('nova'),
    observacaoInterna: text('observacao_interna'),
    lidaEm: date('lida_em'),
    lidaPor: uuid('lida_por'),
    resolvidaEm: date('resolvida_em'),
    resolvidaPor: uuid('resolvida_por'),
  },
  (t) => ({
    filialStatusIdx: index('idx_ouvidoria_filial_status').on(t.filialId, t.status),
  }),
);

export const climaResposta = pgTable(
  'clima_resposta',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** 'YYYY-MM' — decidida no SERVIDOR pela janela aberta (climaDiasJanela/
     *  climaAbertoAte), nunca aceita do cliente. */
    competencia: varchar('competencia', { length: 7 }).notNull(),
    /** 0-10 (eNPS). Validado na API — sem CHECK constraint, mesmo padrão do
     *  resto do schema (ex: avaliacao.nota). */
    nota: integer('nota').notNull(),
    comentario: text('comentario'),
    criadoEm: date('criado_em').notNull(),
  },
  (t) => ({
    filialCompetenciaIdx: index('idx_clima_filial_competencia').on(t.filialId, t.competencia),
  }),
);
