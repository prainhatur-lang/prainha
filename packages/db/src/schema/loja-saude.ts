// Saúde do servidor da loja (vendas-local): quando ele some e por quê.
// - loja_queda: a nuvem anota cada buraco no heartbeat (/api/agente/comandos,
//   que a loja chama a cada ~25 s em long-poll).
// - loja_diagnostico: foto que a loja manda do log do Windows (desligamentos,
//   quedas de energia, reinício por update, suspensão, cabo de rede) + config
//   de energia. Uma linha por filial, sobrescrita a cada envio.

import { pgTable, uuid, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const lojaQueda = pgTable(
  'loja_queda',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** último sinal antes do buraco */
    caiuEm: timestamp('caiu_em', { withTimezone: true }).notNull(),
    /** primeiro sinal depois */
    voltouEm: timestamp('voltou_em', { withTimezone: true }).notNull(),
    segundos: integer('segundos').notNull(),
  },
  (t) => [index('loja_queda_filial_idx').on(t.filialId, t.caiuEm)],
);

export const lojaDiagnostico = pgTable('loja_diagnostico', {
  filialId: uuid('filial_id').primaryKey().references(() => filial.id, { onDelete: 'cascade' }),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  /** {boot, maquina, energia:{suspenderAc,hibernarAc,...}, eventos:[{t,id,p,m,d}]} */
  dados: jsonb('dados').notNull(),
});
