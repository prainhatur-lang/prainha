import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Post montado pela tela /marketing → Publicar (pedido do dono 21/10/2026):
 *  fotos/vídeo no bucket `marketing-midia`, legenda (IA ou escrita), redes
 *  escolhidas e quando sai. Status: RASCUNHO · AGENDADO · PUBLICANDO ·
 *  PUBLICADO (todas as redes ok) · PARCIAL (alguma falhou) · ERRO.
 *  `resultado` guarda o que cada rede respondeu.
 *  (migrate:marketing-post) */
export const marketingPost = pgTable(
  'marketing_post',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull(),
    /** [{path, tipo: 'foto'|'video', nome}] — path dentro do bucket marketing-midia */
    midias: jsonb('midias').$type<Array<{ path: string; tipo: 'foto' | 'video'; nome?: string }>>().notNull(),
    legenda: text('legenda').notNull().default(''),
    /** ['instagram','tiktok'] */
    redes: jsonb('redes').$type<string[]>().notNull(),
    agendadoPara: timestamp('agendado_para', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull().default('RASCUNHO'),
    resultado: jsonb('resultado').$type<Record<string, unknown>>(),
    erro: text('erro'),
    criadoPor: uuid('criado_por'),
    criadoPorEmail: text('criado_por_email'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
    publicadoEm: timestamp('publicado_em', { withTimezone: true }),
  },
  (t) => ({
    filialIdx: index('idx_marketing_post_filial').on(t.filialId, t.criadoEm),
    agendaIdx: index('idx_marketing_post_agenda').on(t.status, t.agendadoPara),
  }),
);
