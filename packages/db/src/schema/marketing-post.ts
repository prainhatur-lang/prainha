import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Post montado pela tela /marketing → Publicar (pedido do dono 21/10/2026):
 *  fotos/vídeo no bucket `marketing-midia`, legenda (IA ou escrita), redes
 *  escolhidas e quando sai. Status: RASCUNHO · AGENDADO · PUBLICANDO ·
 *  PUBLICADO (todas as redes ok) · PARCIAL (alguma falhou) · ERRO ·
 *  AGUARDANDO (fila de aprovação) · RECUSADO.
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
    // ── Fila de aprovação (pedido do dono 25/10/2026) ─────────────────────
    // O Claude monta o post e ele entra como AGUARDANDO; o dono aprova
    // (vira AGENDADO ou sai na hora) ou recusa (RECUSADO, com o motivo).
    // (migrate:marketing-fila)
    /** 'manual' (tela Publicar) · 'claude' (fila de aprovação) */
    origem: varchar('origem', { length: 20 }).notNull().default('manual'),
    titulo: text('titulo'),
    /** O que filmar/fotografar quando o post ainda não tem foto ou vídeo. */
    roteiro: text('roteiro'),
    /** Legenda própria do TikTok (mais curta); vazia = usa a do Instagram. */
    legendaTiktok: text('legenda_tiktok'),
    /** Música sugerida: a API não põe música; escolhe-se no app do TikTok. */
    musica: text('musica'),
    aprovadoPor: uuid('aprovado_por'),
    aprovadoPorEmail: text('aprovado_por_email'),
    aprovadoEm: timestamp('aprovado_em', { withTimezone: true }),
    recusaMotivo: text('recusa_motivo'),
  },
  (t) => ({
    filialIdx: index('idx_marketing_post_filial').on(t.filialId, t.criadoEm),
    agendaIdx: index('idx_marketing_post_agenda').on(t.status, t.agendadoPara),
  }),
);
