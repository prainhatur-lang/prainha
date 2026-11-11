// Nota de serviço (NFS-e Nacional) AVULSA: pra uma empresa de FORA do sistema
// (pedido do dono 11/11/2026). A fatura_servico só serve pras casas (tomador é
// uma filial); aqui o tomador é digitado: CNPJ, razão social e endereço.
//
// Emitente = filial que tem nfse_config + certificado A1 (hoje só a E.B.).
// Código de tributação, alíquota do ISS e retenção são INFORMADOS por quem
// emite (enquadramento é do contador) — o sistema não escolhe nada disso.
// Numeração da DPS: a mesma sequência do nfse_config do emitente.

import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const nfseAvulsa = pgTable(
  'nfse_avulsa',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Emitente (prestador) */
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    tomadorCnpj: varchar('tomador_cnpj', { length: 14 }).notNull(),
    tomadorNome: varchar('tomador_nome', { length: 300 }).notNull(),
    tomadorEmail: varchar('tomador_email', { length: 80 }),
    /** IBGE (7 dígitos) do município do tomador */
    tomadorCodigoMunicipio: varchar('tomador_codigo_municipio', { length: 7 }).notNull(),
    tomadorCidade: varchar('tomador_cidade', { length: 120 }),
    tomadorCep: varchar('tomador_cep', { length: 8 }).notNull(),
    tomadorLogradouro: varchar('tomador_logradouro', { length: 255 }).notNull(),
    tomadorNumero: varchar('tomador_numero', { length: 60 }),
    tomadorBairro: varchar('tomador_bairro', { length: 60 }).notNull(),
    /** Código de tributação nacional (6 dígitos) — informado por quem emite */
    codigoTributacao: varchar('codigo_tributacao', { length: 6 }).notNull(),
    descricao: text('descricao').notNull(),
    /** IBGE do município onde o serviço foi prestado */
    municipioPrestacao: varchar('municipio_prestacao', { length: 7 }).notNull(),
    /** Data de competência do serviço */
    dataCompetencia: date('data_competencia').notNull(),
    valorServico: numeric('valor_servico', { precision: 14, scale: 2 }).notNull(),
    /** % — null = não vai na nota (Simples sem retenção recolhe no DAS) */
    aliquotaIss: numeric('aliquota_iss', { precision: 5, scale: 2 }),
    issRetido: boolean('iss_retido').notNull().default(false),
    valorIss: numeric('valor_iss', { precision: 14, scale: 2 }).notNull().default('0'),
    /** O que o tomador paga (valor − ISS retido) */
    valorLiquido: numeric('valor_liquido', { precision: 14, scale: 2 }).notNull(),
    /** RASCUNHO | EMITIDA | CANCELADA (cancelada = rascunho descartado) */
    status: varchar('status', { length: 12 }).notNull().default('RASCUNHO'),
    nfseNumeroDps: integer('nfse_numero_dps'),
    nfseNumero: varchar('nfse_numero', { length: 20 }),
    nfseChave: varchar('nfse_chave', { length: 60 }),
    nfseEmitidaEm: timestamp('nfse_emitida_em', { withTimezone: true }),
    nfseXml: text('nfse_xml'),
    nfseErro: text('nfse_erro'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_nfse_avulsa_filial').on(t.filialId, t.criadoEm)],
);
