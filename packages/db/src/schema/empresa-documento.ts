// Documentos da empresa por casa (pedido do dono 26/10/2026: "da opcao para
// subir documentos como alvara etc. vendo as validades e avisando quando
// estiver proximo de expirar").
//
// Um arquivo por linha: alvará de funcionamento, alvará sanitário, inscrição
// municipal, cartão CNPJ, certidões, AVCB, licença ambiental... A IA lê tipo,
// número, órgão, emissão e validade; o dono confere e salva. Sem validade
// (cartão CNPJ, inscrição) = `sem_vencimento`.
// Renovação não apaga: a nova linha entra e a anterior ganha `substituido_por`.
// Vigentes = substituido_por IS NULL AND cancelado_em IS NULL.
// Arquivo no bucket privado `extratos-fechamento`, pasta empresa-documentos/<org>/.

import { pgTable, uuid, varchar, timestamp, text, date, boolean, index, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const empresaDocumento = pgTable(
  'empresa_documento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** chave de lib/empresa-documento.ts (alvara_funcionamento, alvara_sanitario…) */
    tipo: varchar('tipo', { length: 40 }).notNull(),
    /** nome como aparece na lista ("Alvará sanitário nº 15102") */
    titulo: text('titulo'),
    numero: varchar('numero', { length: 80 }),
    orgao: text('orgao'),
    cnpj: varchar('cnpj', { length: 14 }),
    emissao: date('emissao'),
    validade: date('validade'),
    semVencimento: boolean('sem_vencimento').notNull().default(false),
    observacao: text('observacao'),
    arquivoPath: text('arquivo_path').notNull(),
    arquivoNome: varchar('arquivo_nome', { length: 200 }),
    /** O que a IA leu do arquivo (pra conferir depois). */
    dados: jsonb('dados'),
    usuarioId: uuid('usuario_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    /** Renovação: a linha nova que tomou o lugar desta. */
    substituidoPor: uuid('substituido_por'),
    substituidoEm: timestamp('substituido_em', { withTimezone: true }),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoPor: uuid('cancelado_por'),
    canceladoMotivo: text('cancelado_motivo'),
  },
  (t) => ({
    porCasa: index('idx_empresa_documento_filial').on(t.filialId, t.validade),
  }),
);
