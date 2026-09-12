import { sql } from 'drizzle-orm';
import { date, index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { filial } from './tenant';

/** Foto do dia que a loja (vendas-local) manda pra nuvem de tempos em tempos:
 *  comandas/pessoas/recebido até agora × ontem × semana passada, ocupação,
 *  atrasos por praça, cancelamentos, estornos, reaberturas, liberações e
 *  reclamações. Cada envio vira uma linha — o dia tem uma linha de evolução
 *  (o que estava acontecendo às 13h, 14h…) e a ÚLTIMA linha do dia é o balanço
 *  final. O shape de `dados` é o `montarBalanco()` do vendas-local. */
export const balancoLoja = pgTable(
  'balanco_loja',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** Dia (BRT) a que a foto se refere. */
    dia: date('dia').notNull(),
    /** Quando a loja tirou a foto. */
    capturadoEm: timestamp('capturado_em', { withTimezone: true }).notNull(),
    /** VERSAO do vendas-local que mandou (sha curto). */
    versao: varchar('versao', { length: 16 }),
    dados: jsonb('dados').notNull(),
    recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    porDia: index('bl_filial_dia_capturado').on(t.filialId, t.dia, t.capturadoEm),
  }),
);
