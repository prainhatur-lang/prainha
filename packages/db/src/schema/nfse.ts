// Faturas de serviço com NFS-e — a E.B. Serviços (empresa à parte, fora do
// grupo Prainha) fatura pra cada casa a mão de obra do mês: custo da folha
// da E.B. naquela casa (folha do contador, por departamento) + um percentual
// de lucro. ISS retido pela casa (LC 116 item 17.05, ISS do município do
// tomador); sem INSS/IR/PIS/COFINS/CSLL porque a E.B. é do Simples.
//
// A E.B. existe como `organizacao` + `filial` próprias (codigo 'eb'), mas NÃO
// entra em `usuario_filial`: senão apareceria no seletor de casa e viraria a
// "primeira filial" (ordem por CNPJ) de todas as telas. O acesso às telas da
// E.B. é por permissão (folha_equipe.fechar).
//
// `nfse_config`: dados do emitente pra NFS-e Nacional (1 linha por filial
// emitente). `fatura_servico`: uma fatura por casa por competência.

import {
  pgTable,
  uuid,
  varchar,
  integer,
  date,
  timestamp,
  numeric,
  boolean,
  text,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { filial } from './tenant';

/** Base do valor da fatura, tirada da folha do contador. */
export type BaseFaturaServico = 'proventos_fgts' | 'proventos' | 'liquido';

export const nfseConfig = pgTable('nfse_config', {
  filialId: uuid('filial_id').primaryKey().references(() => filial.id, { onDelete: 'cascade' }),
  razaoSocial: varchar('razao_social', { length: 150 }).notNull(),
  cnpj: varchar('cnpj', { length: 14 }).notNull(),
  inscricaoMunicipal: varchar('inscricao_municipal', { length: 20 }),
  /** IBGE do município do emitente (Aracaju 2800308). */
  codigoMunicipio: varchar('codigo_municipio', { length: 7 }).notNull(),
  /** 'producao' | 'homologacao' (produção restrita da NFS-e Nacional). */
  ambiente: varchar('ambiente', { length: 12 }).notNull().default('producao'),
  /** Código de tributação nacional (170501 = fornecimento de mão de obra). */
  codigoTributacao: varchar('codigo_tributacao', { length: 6 }).notNull().default('170501'),
  /** Alíquota efetiva do Simples (%), que muda todo mês — vai na nota e no ISS retido. */
  aliquotaIss: numeric('aliquota_iss', { precision: 5, scale: 2 }),
  /** Lucro sobre a folha (%), definido pelo dono. */
  percentualLucro: numeric('percentual_lucro', { precision: 6, scale: 2 }).notNull().default('0'),
  base: varchar('base', { length: 20 }).$type<BaseFaturaServico>().notNull().default('proventos_fgts'),
  /** Dia do mês seguinte em que a fatura vence. */
  diaVencimento: integer('dia_vencimento').notNull().default(10),
  serieDps: varchar('serie_dps', { length: 5 }).notNull().default('1'),
  proximoNumeroDps: integer('proximo_numero_dps').notNull().default(1),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoPor: uuid('atualizado_por'),
});

export const faturaServico = pgTable(
  'fatura_servico',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Emitente (a filial da E.B.). */
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** A casa que toma o serviço. */
    tomadorFilialId: uuid('tomador_filial_id').notNull().references(() => filial.id, { onDelete: 'restrict' }),
    /** 'AAAA-MM'. */
    competencia: varchar('competencia', { length: 7 }).notNull(),

    empregados: integer('empregados').notNull().default(0),
    horas: numeric('horas', { precision: 10, scale: 2 }).notNull().default('0'),
    proventos: numeric('proventos', { precision: 12, scale: 2 }).notNull().default('0'),
    fgts: numeric('fgts', { precision: 12, scale: 2 }).notNull().default('0'),
    liquidoFolha: numeric('liquido_folha', { precision: 12, scale: 2 }).notNull().default('0'),
    base: varchar('base', { length: 20 }).$type<BaseFaturaServico>().notNull(),
    valorBase: numeric('valor_base', { precision: 12, scale: 2 }).notNull(),
    percentualLucro: numeric('percentual_lucro', { precision: 6, scale: 2 }).notNull(),
    valorLucro: numeric('valor_lucro', { precision: 12, scale: 2 }).notNull(),
    /** Valor da nota (base + lucro). */
    valorServico: numeric('valor_servico', { precision: 12, scale: 2 }).notNull(),
    aliquotaIss: numeric('aliquota_iss', { precision: 5, scale: 2 }).notNull(),
    valorIss: numeric('valor_iss', { precision: 12, scale: 2 }).notNull(),
    issRetido: boolean('iss_retido').notNull().default(true),
    /** O que a casa paga à E.B. (serviço − ISS retido). */
    valorLiquido: numeric('valor_liquido', { precision: 12, scale: 2 }).notNull(),
    vencimento: date('vencimento').notNull(),
    discriminacao: text('discriminacao').notNull(),

    /** RASCUNHO → EMITIDA (NFS-e autorizada) | CANCELADA. */
    status: varchar('status', { length: 12 }).notNull().default('RASCUNHO'),
    recebidoEm: date('recebido_em'),
    valorRecebido: numeric('valor_recebido', { precision: 12, scale: 2 }),
    /** Contas lançadas na casa: o líquido pra E.B. e a guia do ISS retido. */
    contaPagarId: uuid('conta_pagar_id'),
    contaIssId: uuid('conta_iss_id'),

    /** Fatura dividida: esta é a parte separada da fatura principal (mesma casa
     *  e competência da folha), com a NFS-e em outra competência. */
    complementoDe: uuid('complemento_de'),
    /** 'AAAA-MM' da NFS-e quando difere da competência da folha (dCompet). */
    competenciaNfse: varchar('competencia_nfse', { length: 7 }),

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
  (t) => ({
    compIdx: index('idx_fatura_servico_comp').on(t.filialId, t.competencia),
    tomadorIdx: index('idx_fatura_servico_tomador').on(t.tomadorFilialId, t.competencia),
  }),
);
