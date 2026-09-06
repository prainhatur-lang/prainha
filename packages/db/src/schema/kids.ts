// Espaço Kids — ponte do WhatsApp pro vendas-local.
//
// O controle de verdade (criança, mesa, monitora, chamadas) mora no Postgres
// da LOJA (kids_entrada/kids_crianca/kids_evento no server.mjs). A nuvem só
// guarda o mínimo pra conversar com o responsável pela Meta: o código do QR
// que ele manda pra confirmar o zap, o telefone que a Meta viu e as mensagens
// trocadas. Spec: docs/superpowers/specs/2026-09-03-espaco-kids-design.md

import { pgTable, uuid, varchar, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const kidsCheckin = pgTable(
  'kids_checkin',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** 6 chars de "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", gerado pela loja. */
    codigo: varchar('codigo', { length: 8 }).notNull(),
    /** Número da casa (whatsapp_numero) usado no QR — é por ele que a
     *  resposta chega e é por ele que a casa fala de volta. */
    phoneNumberId: text('phone_number_id').notNull(),
    /** O que a monitora digitou (só dígitos, sem DDI). Registro. */
    telefoneDigitado: varchar('telefone_digitado', { length: 20 }).notNull(),
    /** O `from` que a Meta viu na mensagem do QR — é pra ESSE que se envia. */
    telefoneConfirmado: varchar('telefone_confirmado', { length: 20 }),
    responsavelNome: varchar('responsavel_nome', { length: 160 }).notNull(),
    /** "Maria (6) e João (4)" — pronto pras mensagens. */
    criancas: text('criancas').notNull(),
    mesa: integer('mesa'),
    /** Link "Share livestream" do UniFi Protect (config da loja). */
    linkCamera: text('link_camera'),
    /** aguardando | confirmado | encerrado | expirado */
    status: varchar('status', { length: 20 }).notNull().default('aguardando'),
    confirmadoEm: timestamp('confirmado_em', { withTimezone: true }),
    encerradoEm: timestamp('encerrado_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codigoUx: uniqueIndex('ux_kids_checkin_codigo').on(t.filialId, t.codigo),
    telIdx: index('ix_kids_checkin_tel').on(t.phoneNumberId, t.telefoneConfirmado, t.status),
  }),
);

export const kidsMensagem = pgTable(
  'kids_mensagem',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    checkinId: uuid('checkin_id').notNull().references(() => kidsCheckin.id, { onDelete: 'cascade' }),
    /** entrada (do responsável) | saida (da casa) */
    direcao: varchar('direcao', { length: 10 }).notNull(),
    texto: text('texto').notNull(),
    waMessageId: text('wa_message_id'),
    erro: text('erro'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    checkinIdx: index('ix_kids_mensagem_checkin').on(t.checkinId, t.criadoEm),
    waUx: uniqueIndex('ux_kids_mensagem_wa').on(t.waMessageId).where(sql`wa_message_id IS NOT NULL`),
  }),
);
