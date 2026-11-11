// Chaves Pix de cada empresa do sistema — uma empresa tem MAIS DE UMA chave,
// cada uma num banco (dono, 11/11/2026: "tem um Pix que é o CNPJ, de um banco;
// tem a chave aleatória, que é de outro banco").
//
// A chave `principal` é a que as outras empresas usam pra pagar a ela: fica
// espelhada em filial.pix_transf_* e no cadastro dela como fornecedor (mesmo
// CNPJ) em todas as empresas — lib/empresa-pix. As demais ficam guardadas aqui
// com o banco, pra ninguém precisar perguntar de novo.
// Chave só entra pela mão do dono (Admin). Nada é deduzido de CNPJ.

import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { filial } from './tenant';

export const empresaPixChave = pgTable(
  'empresa_pix_chave',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    chave: varchar('chave', { length: 100 }).notNull(),
    /** Banco em que a chave está (texto livre: Sicredi, Inter, Itaú…) */
    banco: varchar('banco', { length: 60 }),
    /** Nome que aparece no banco, se for diferente da razão social */
    favorecido: varchar('favorecido', { length: 200 }),
    /** A que as outras empresas usam pra pagar a ela (uma por empresa) */
    principal: boolean('principal').notNull().default(false),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    removidoPor: uuid('removido_por'),
    removidoEm: timestamp('removido_em', { withTimezone: true }),
  },
  (t) => [index('idx_empresa_pix_chave_filial').on(t.filialId)],
);
