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
