import { pgTable, uuid, text, timestamp, varchar, bigint } from 'drizzle-orm/pg-core';

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
