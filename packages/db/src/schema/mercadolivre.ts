import { pgTable, uuid, text, timestamp, varchar, bigint, numeric, jsonb } from 'drizzle-orm/pg-core';

// Conta do Mercado Livre ligada ao sistema (lado COMPRADOR). Uma linha por
// conta ML: vale pra todas as casas; a casa de cada compra sai depois pelo
// endereço de entrega. Os tokens ficam cifrados (lib/segredo, CREDENCIAL_SECRET).
// Migration: packages/db/scripts/migrate-mercadolivre.ts
export const mlConta = pgTable('ml_conta', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** user_id do Mercado Livre (o "buyer" das compras) */
  mlUserId: bigint('ml_user_id', { mode: 'number' }).notNull().unique(),
  nickname: varchar('nickname', { length: 120 }),
  email: varchar('email', { length: 200 }),
  accessTokenCifrado: text('access_token_cifrado').notNull(),
  refreshTokenCifrado: text('refresh_token_cifrado').notNull(),
  /** quando o access_token vence (ML: 6 horas) */
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  ligadoPor: uuid('ligado_por'),
  ligadoEm: timestamp('ligado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  /** último erro ao falar com a API (renovação/listagem), pra tela mostrar */
  ultimoErro: text('ultimo_erro'),
});

// E-mails do Mercado Livre / Mercado Pago (plano B, sem a API: o ML não libera
// criar app pra conta compradora). Um script do Google na conta que compra
// (procupom11) empurra os e-mails pra /api/mercadolivre/email; aqui fica o
// e-mail cru + o que deu pra ler dele (pedido, total, tipo). Um por message-id.
// Migration: packages/db/scripts/migrate-mercadolivre-email.ts
export const mlEmail = pgTable('ml_email', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** id da mensagem no Gmail */
  messageId: varchar('message_id', { length: 120 }).notNull().unique(),
  recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull(),
  conta: varchar('conta', { length: 200 }),
  de: varchar('de', { length: 300 }),
  assunto: text('assunto'),
  texto: text('texto'),
  html: text('html'),
  /** lido do e-mail: compra | pagamento | envio | entrega | outro */
  tipo: varchar('tipo', { length: 20 }),
  pedidoMl: varchar('pedido_ml', { length: 40 }),
  total: numeric('total', { precision: 12, scale: 2 }),
  dados: jsonb('dados'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
