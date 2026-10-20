import { index, jsonb, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Pix pago pelo sistema via API do Inter (tela Pedidos a pagar por Pix).
 *  Pedido do dono em 20/10/2026. A linha nasce ENVIANDO antes de chamar o
 *  banco; o `id` vai como chave de idempotência. Status:
 *  ENVIANDO (sem resposta) · APROVACAO (esperando aprovar no app do Inter) ·
 *  AGENDADO · PAGO (baixa feita nas contas) · ERRO (não saiu dinheiro).
 *  (migrate:pix-pagamento) */
export const pixPagamento = pgTable(
  'pix_pagamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull(),
    fornecedorId: uuid('fornecedor_id'),
    favorecido: text('favorecido'),
    /** contas que este Pix quita e quanto de cada: [{id, valor}] */
    contaIds: jsonb('conta_ids').$type<Array<{ id: string; valor: number }>>().notNull(),
    chave: text('chave').notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    descricao: text('descricao'),
    status: varchar('status', { length: 20 }).notNull().default('ENVIANDO'),
    statusInter: varchar('status_inter', { length: 40 }),
    codigoSolicitacao: varchar('codigo_solicitacao', { length: 80 }),
    endToEndId: varchar('end_to_end_id', { length: 80 }),
    retorno: jsonb('retorno'),
    erro: text('erro'),
    usuarioId: uuid('usuario_id'),
    usuarioEmail: text('usuario_email'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
    baixadoEm: timestamp('baixado_em', { withTimezone: true }),
  },
  (t) => ({
    filialIdx: index('idx_pix_pagamento_filial').on(t.filialId, t.criadoEm),
    statusIdx: index('idx_pix_pagamento_status').on(t.status),
  }),
);
