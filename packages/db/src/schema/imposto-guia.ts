// Guias de imposto lançadas pela contabilidade (/financeiro/impostos, 22/10/2026).
//
// A contabilidade sobe a guia (PDF ou foto), a IA lê (tipo, contribuinte,
// competência, vencimento, valor, código de barras) e o sistema propõe pra
// onde vai:
//   - FOLHA: guia da E.B. ou da Lelis (INSS, FGTS, DAS). A guia inteira vira
//     conta na empresa que paga (E.B. tem filial própria) e cada casa ganha
//     uma conta "repasse" pra E.B./Lelis com a parte dela, pela proporção do
//     FGTS da folha do contador da competência.
//   - PERCENTUAL: imposto da Prainha Turismo da empresa toda (IRPJ, CSLL,
//     PIS/COFINS, DAS parcelado) — a contabilidade digita o % de cada casa.
//   - CASA: imposto de uma casa só (ISS, ICMS, alvará) — 100% nela.
// Arquivo no bucket público `producao-fotos`, pasta `impostos/` (o mesmo do
// boleto anexado: as contas geradas levam o caminho em boleto_storage_path).

import { pgTable, uuid, varchar, timestamp, text, numeric, date, index, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export interface ImpostoRateio {
  filialId: string;
  percentual: number;
  valor: number;
  /** Conta criada na casa (imposto direto ou repasse pra quem paga). */
  contaPagarId?: string | null;
}

export const impostoGuia = pgTable(
  'imposto_guia',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    arquivoPath: text('arquivo_path').notNull().unique(),
    arquivoHash: varchar('arquivo_hash', { length: 64 }).notNull().unique(),
    arquivoNome: text('arquivo_nome'),
    mime: varchar('mime', { length: 60 }),
    lido: jsonb('lido'),
    erro: text('erro'),
    /** DAS | INSS | FGTS | IRPJ | CSLL | PIS | COFINS | PIS_COFINS | ISS | ICMS | DARF | OUTRO */
    tipo: varchar('tipo', { length: 20 }),
    contribuinteCnpj: varchar('contribuinte_cnpj', { length: 14 }),
    contribuinteNome: text('contribuinte_nome'),
    /** AAAA-MM */
    competencia: varchar('competencia', { length: 7 }),
    vencimento: date('vencimento'),
    valor: numeric('valor', { precision: 14, scale: 2 }),
    codigoBarras: varchar('codigo_barras', { length: 60 }),
    descricao: text('descricao'),
    /** FOLHA | PERCENTUAL | CASA */
    regra: varchar('regra', { length: 12 }),
    /** Filial de quem paga a guia inteira (E.B.); nulo quando é a própria casa ou a Lelis (sem filial). */
    pagadoraFilialId: uuid('pagadora_filial_id'),
    /** Nome de quem paga: "E.B. Serviços", "Lelis", "Prainha Turismo". */
    pagadoraNome: text('pagadora_nome'),
    rateio: jsonb('rateio').$type<ImpostoRateio[]>().notNull().default(sql`'[]'::jsonb`),
    /** Conta da guia inteira na filial pagadora (E.B.). */
    contaGuiaId: uuid('conta_guia_id'),
    /** LIDA | LANCADA | DESCARTADA | ERRO */
    status: varchar('status', { length: 12 }).notNull().default('LIDA'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    lancadoPor: uuid('lancado_por'),
    lancadoEm: timestamp('lancado_em', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('imposto_guia_status_idx').on(t.status, t.criadoEm),
    barrasIdx: index('imposto_guia_barras_idx').on(t.codigoBarras),
  }),
);
