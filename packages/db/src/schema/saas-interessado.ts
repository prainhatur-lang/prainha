// Interessados no Concilia como sistema (SaaS) — 02/11/2026.
// Vem do site público /conheca (botão "Quero começar"), aberto pela demo da
// maquininha ou por link. Não é de filial nenhuma: é o funil de venda do
// próprio Concilia. Lista em /saas/interessados (só Admin).

import { pgTable, uuid, varchar, timestamp, text, integer, index } from 'drizzle-orm/pg-core';

export const saasInteressado = pgTable(
  'saas_interessado',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nome: varchar('nome', { length: 200 }).notNull(),
    estabelecimento: varchar('estabelecimento', { length: 200 }),
    cidade: varchar('cidade', { length: 120 }),
    whatsapp: varchar('whatsapp', { length: 20 }).notNull(),
    email: varchar('email', { length: 200 }),
    maquininhas: integer('maquininhas'),
    /** gratis | essencial | gestao | completo | consultoria | nao_sei */
    plano: varchar('plano', { length: 30 }),
    mensagem: text('mensagem'),
    /** De onde veio: app_demo (QR da maquininha), site, ... */
    origem: varchar('origem', { length: 40 }),
    /** novo | contatado | cliente | descartado */
    status: varchar('status', { length: 20 }).notNull().default('novo'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('saas_interessado_criado_idx').on(t.criadoEm)],
);
