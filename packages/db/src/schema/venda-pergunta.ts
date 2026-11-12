// "Chegou estoque e não está à venda" (dono, 11/11/2026): quando entra estoque
// de um produto desligado pro garçom, pro QR do cliente ou pro delivery, o
// sistema pergunta se é pra ligar. Quem responde "deixar como está" cai aqui,
// pra a pergunta não voltar toda vez. Uma linha por produto (tamanho) e casa.
import { pgTable, uuid, timestamp, varchar, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { produtoVariante } from './produto_variante';

export const vendaPerguntaDispensa = pgTable(
  'venda_pergunta_dispensa',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    varianteId: uuid('variante_id').notNull().references(() => produtoVariante.id, { onDelete: 'cascade' }),
    dispensadoPor: varchar('dispensado_por', { length: 120 }),
    dispensadoEm: timestamp('dispensado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: unique('uq_venda_pergunta_dispensa').on(t.filialId, t.varianteId) }),
);
