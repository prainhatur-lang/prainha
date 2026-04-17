import { pgTable, uuid, text, timestamp, varchar, primaryKey, index, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const organizacao = pgTable('organizacao', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  nome: varchar('nome', { length: 200 }).notNull(),
  cnpjRaiz: varchar('cnpj_raiz', { length: 8 }), // 8 primeiros digitos do CNPJ
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const filial = pgTable(
  'filial',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizacaoId: uuid('organizacao_id')
      .notNull()
      .references(() => organizacao.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 200 }).notNull(),
    cnpj: varchar('cnpj', { length: 14 }).notNull(),
    /** Token usado pelo agente local para se autenticar na ingestao */
    agenteToken: text('agente_token').notNull().unique(),
    /** Ultima vez que o agente local enviou dados */
    ultimoPing: timestamp('ultimo_ping', { withTimezone: true }),
    /** Ignora pagamentos anteriores a esta data na conciliacao. Null = sem corte. */
    dataInicioConciliacao: date('data_inicio_conciliacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('filial_org_idx').on(t.organizacaoId),
  }),
);

export const usuario = pgTable('usuario', {
  /** mesmo id do auth.users do Supabase */
  id: uuid('id').primaryKey(),
  email: varchar('email', { length: 200 }).notNull().unique(),
  nome: varchar('nome', { length: 200 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Acesso de usuarios a filiais. Role DONO ve todas, GERENTE ve as listadas. */
export const usuarioFilial = pgTable(
  'usuario_filial',
  {
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20, enum: ['DONO', 'GERENTE'] }).notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.usuarioId, t.filialId] }),
    filialIdx: index('uf_filial_idx').on(t.filialId),
  }),
);
