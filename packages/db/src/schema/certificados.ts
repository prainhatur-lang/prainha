// Certificados digitais A1 por filial — usados pra consultar SEFAZ
// (manifesto, distribuição DF-e) automaticamente sem upload manual.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  boolean,
  date,
  unique,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const certificadoFilial = pgTable(
  'certificado_filial',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** CNPJ do certificado (pode ser diferente do CNPJ da filial se for matriz) */
    cnpjCertificado: varchar('cnpj_certificado', { length: 14 }),
    /** Nome apresentado no certificado (CN) */
    cn: varchar('cn', { length: 300 }),
    /** Path no Supabase Storage (bucket 'certificados' privado) */
    pfxStoragePath: text('pfx_storage_path').notNull(),
    /** Senha do PFX criptografada (AES-256-GCM com env CERTIFICATE_SECRET) */
    senhaCifrada: text('senha_cifrada').notNull(),
    /** Validade lida do certificado */
    validadeInicio: date('validade_inicio'),
    validadeFim: date('validade_fim'),
    /** Nome original do arquivo (pra referencia do user) */
    nomeArquivo: varchar('nome_arquivo', { length: 200 }),
    /** Se este e' o certificado ativo pra SEFAZ (so 1 por filial) */
    ativo: boolean('ativo').notNull().default(true),
    /** Se true, esse cert pode ser usado por TODAS as filiais da mesma
     *  organizacao (mesmo cnpj_raiz). Util quando upa o cert da matriz e
     *  quer usar pras 3 filiais da Prainha sem replicar upload. */
    compartilharOrganizacao: boolean('compartilhar_organizacao').notNull().default(false),
    /** NSU ultimo retornado pela distribuicao DF-e — checkpoint */
    ultimoNsu: varchar('ultimo_nsu', { length: 15 }),
    ultimaConsultaSefaz: timestamp('ultima_consulta_sefaz', { withTimezone: true }),
    uploadadoPor: uuid('uploadado_por'),
    uploadadoEm: timestamp('uploadado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqAtivoFilial: unique('uq_cert_filial_ativo').on(t.filialId, t.ativo),
  }),
);

/** Checkpoint NSU por (certificado, filial). Necessario quando cert e
 *  compartilhado pra varias filiais — cada filial tem propria sequencia
 *  NSU na SEFAZ (per CNPJ destinatario), entao precisa rastrear separado.
 *  Substitui certificado_filial.ultimo_nsu (que so funcionava quando cert
 *  pertencia a 1 filial). */
export const certFilialNsu = pgTable(
  'cert_filial_nsu',
  {
    certId: uuid('cert_id')
      .notNull()
      .references(() => certificadoFilial.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    ultimoNsu: varchar('ultimo_nsu', { length: 15 }).notNull().default('000000000000000'),
    ultimaConsultaEm: timestamp('ultima_consulta_em', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.certId, t.filialId] }),
  }),
);
