import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Instagram → TikTok automático por casa (pedido do dono 25/10/2026): com
 *  `ativo`, todo post novo do Instagram (feito depois de `desde`, até pelo app
 *  do Instagram) vai sozinho pra caixa de entrada do TikTok da mesma casa.
 *  (migrate:marketing-espelho) */
export const marketingEspelho = pgTable('marketing_espelho', {
  filialId: uuid('filial_id').primaryKey(),
  ativo: boolean('ativo').notNull().default(false),
  desde: timestamp('desde', { withTimezone: true }).notNull().defaultNow(),
  atualizadoPor: text('atualizado_por'),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Cada post do Instagram que o espelho mandou (ou tentou) pro TikTok.
 *  Status: OK · ERRO (tenta de novo até 3x) · DESISTIU · PULADO (já foi pelo Publicar). */
export const marketingEspelhoEnvio = pgTable(
  'marketing_espelho_envio',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull(),
    igPostId: varchar('ig_post_id', { length: 40 }).notNull(),
    igLink: text('ig_link'),
    igQuando: timestamp('ig_quando', { withTimezone: true }),
    status: varchar('status', { length: 12 }).notNull(),
    tentativas: integer('tentativas').notNull().default(0),
    publishId: text('publish_id'),
    tipo: varchar('tipo', { length: 10 }),
    erro: text('erro'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    postUq: uniqueIndex('uq_marketing_espelho_envio_post').on(t.filialId, t.igPostId),
    filialIdx: index('idx_marketing_espelho_envio_filial').on(t.filialId, t.criadoEm),
  }),
);
