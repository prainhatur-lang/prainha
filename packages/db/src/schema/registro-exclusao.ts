import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Registro de exclusão: quem apagou o quê, quando e por quê.
 *  Pedido do dono em 20/10/2026 ("exclusão é algo sério, tem que ter
 *  registro"): uma conta de R$ 667 da Hortifruti Itabaiana sumiu da Prainha
 *  Mar e não havia como saber quem excluiu. Grava ANTES de apagar — se o
 *  registro falhar, a exclusão não acontece. `dados` guarda a foto do que
 *  foi apagado (a linha inteira) pra conferir/reverter depois.
 *  (migrate:registro-exclusao) */
export const registroExclusao = pgTable(
  'registro_exclusao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id'),
    /** conta_pagar | conta_pagar_baixa | nota_compra */
    tabela: varchar('tabela', { length: 40 }).notNull(),
    registroId: uuid('registro_id').notNull(),
    /** Uma linha legível: fornecedor · vencimento · valor */
    resumo: text('resumo'),
    motivo: text('motivo'),
    usuarioId: uuid('usuario_id'),
    usuarioEmail: text('usuario_email'),
    dados: jsonb('dados'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialIdx: index('idx_registro_exclusao_filial').on(t.filialId, t.criadoEm),
    registroIdx: index('idx_registro_exclusao_registro').on(t.registroId),
  }),
);
