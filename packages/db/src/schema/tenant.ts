import { pgTable, uuid, text, timestamp, varchar, primaryKey, index, date, jsonb, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Percentuais de taxas Cielo por forma + bandeira. Usado pela engine Banco
 * pra calcular valor liquido esperado no credito bancario. Todos em %. */
export interface TaxasPorBandeira {
  pix: number;
  debito: Record<string, number>; // bandeira normalizada (visa, mastercard, elo, amex, diners) → %
  credito_a_vista: Record<string, number>;
}

/** Prazos de liquidacao em dias corridos por forma. EC Online pode ter
 * prazos maiores (D+30 padrao) ou antecipacao (D+1). */
export interface PrazosLiquidacao {
  pix: number; // dias (normal: 1)
  debito: number; // dias (normal: 1)
  credito_a_vista: number; // dias (normal: 30)
}

/** Config de um estabelecimento Cielo (EC) — pode ser TEF, Online, etc.
 *  Cada EC pode ter taxas E prazos diferentes (TEF normalmente D+1/D+30,
 *  Online pode ter antecipacao ou prazo maior). */
export interface EstabelecimentoConfig extends TaxasPorBandeira {
  codigo: string; // EC, ex: "1115651924"
  rotulo?: string; // nome amigavel
  canal?: 'TEF' | 'ONLINE' | string;
  prazos?: PrazosLiquidacao;
}

/** Config de taxas da filial: lista de ECs + default pra casos nao mapeados. */
export interface TaxasFilial {
  ecs: EstabelecimentoConfig[];
  default: TaxasPorBandeira;
}

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
    /** Taxas Cielo por forma + bandeira (null = usar defaults) */
    taxas: jsonb('taxas').$type<TaxasFilial>(),
    /** Valor max (em R$) de diff PDV vs Cielo que a conciliacao Operadora
     *  aceita automaticamente quando a data eh exata. Acima disso vira
     *  divergencia pra revisao manual. Default 0.90. */
    toleranciaAutoAceite: numeric('tolerancia_auto_aceite', { precision: 10, scale: 2 })
      .notNull()
      .default('0.90'),
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
