// Relatório diário das casas, mandado todo dia pelo WhatsApp pro dono.
// - relatorio_diario_config: 1 linha por organização — quem recebe e se está ligado.
// - relatorio_diario_envio: cada tentativa de envio (modelo/texto) e cada vez que
//   o destinatário falou com a gente (toque no botão / pediu "relatório") — é o
//   que diz se a janela de 24 h do WhatsApp está aberta pra mandar texto livre.

import { pgTable, uuid, varchar, text, boolean, date, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizacao } from './tenant';

export interface DestinoCasaConfig {
  nome: string;
  /** só dígitos, com 55 */
  telefone: string;
  filialIds: string[];
  /** true = faturamento e períodos com os 10%; false = líquido, sem o serviço */
  comServico: boolean;
  /** o que vai na mensagem */
  itens: { faturamento: boolean; contas: boolean; periodos: boolean; picos: boolean };
  /** todo dia às 07:00, o dia anterior */
  diario: boolean;
  /** todo dia 01, o mês anterior */
  mensal: boolean;
  /** primeiro dia que a pessoa recebe (YYYY-MM-DD) */
  desde: string;
}

/** Quem recebe às 07:00 a lista de reservas de hoje (20/10/2026). */
export interface DestinoReservasConfig {
  nome: string;
  /** só dígitos, com 55 */
  telefone: string;
  filialIds: string[];
  ativo: boolean;
}

export const relatorioDiarioConfig = pgTable('relatorio_diario_config', {
  organizacaoId: uuid('organizacao_id')
    .primaryKey()
    .references(() => organizacao.id, { onDelete: 'cascade' }),
  ativo: boolean('ativo').notNull().default(true),
  /** Telefones (só dígitos, com DDI 55) que recebem o relatório. */
  telefones: jsonb('telefones').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /**
   * Quem recebe só algumas casas (relatório por casa). NULL = nunca salvo pela
   * tela → vale a lista fixa de apps/web/src/lib/relatorio-casa-envio.ts.
   */
  destinosCasa: jsonb('destinos_casa').$type<DestinoCasaConfig[]>(),
  /** Lista de reservas do dia, todo dia às 07:00 (NULL = ninguém cadastrado). */
  destinosReservas: jsonb('destinos_reservas').$type<DestinoReservasConfig[]>(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoPor: uuid('atualizado_por'),
});

export const relatorioDiarioEnvio = pgTable(
  'relatorio_diario_envio',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizacaoId: uuid('organizacao_id')
      .notNull()
      .references(() => organizacao.id, { onDelete: 'cascade' }),
    /** dia operacional do relatório (05:00 → 05:00) */
    dia: date('dia').notNull(),
    telefone: varchar('telefone', { length: 20 }).notNull(),
    /** 'modelo' (template da Meta) | 'texto' (texto livre) | 'toque' (o destinatário falou com a gente) */
    canal: varchar('canal', { length: 12 }).notNull(),
    /** 'cron' | 'manual' | 'toque' | 'pedido' */
    origem: varchar('origem', { length: 12 }).notNull().default('cron'),
    ok: boolean('ok').notNull(),
    erro: text('erro'),
    waMessageId: text('wa_message_id'),
    /** número da casa (phone_number_id da Meta) por onde a mensagem passou */
    phoneNumberId: text('phone_number_id'),
    /** retorno da Meta pelo webhook: 'enviada' | 'entregue' | 'lida' | 'erro' (NULL = sem retorno ainda) */
    statusEntrega: varchar('status_entrega', { length: 12 }),
    statusEm: timestamp('status_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('relatorio_diario_envio_dia_idx').on(t.organizacaoId, t.dia),
    index('relatorio_diario_envio_fone_idx').on(t.telefone, t.criadoEm),
    index('relatorio_diario_envio_wa_idx').on(t.waMessageId),
  ],
);
