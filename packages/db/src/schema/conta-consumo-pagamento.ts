import { date, index, jsonb, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Conta de consumo (energia, água, gás, telefone…) ou boleto que não chega
 *  pelo DDA, paga pelo sistema via API do Inter — tela /financeiro/pagar-conta.
 *  Pedido do dono em 23/11/2026. Dois jeitos:
 *   - BOLETO: código de barras / linha digitável (44, 47 ou 48 dígitos)
 *     → POST /banking/v2/pagamento
 *   - PIX: Pix copia-e-cola lido do QR da conta → POST /banking/v2/pix
 *  A linha nasce ENVIANDO antes de chamar o banco (o `id` vai como chave de
 *  idempotência). Status: ENVIANDO · APROVACAO · AGENDADO · PAGO · ERRO ·
 *  CANCELADO. (migrate:conta-consumo-pagamento) */
export const contaConsumoPagamento = pgTable(
  'conta_consumo_pagamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull(),
    /** BOLETO | PIX */
    tipo: varchar('tipo', { length: 10 }).notNull(),
    /** o que foi lido/colado: linha digitável ou Pix copia-e-cola */
    codigo: text('codigo').notNull(),
    /** código de barras de 44 dígitos (só BOLETO) — trava de pagar 2x */
    codigoBarras: varchar('codigo_barras', { length: 44 }),
    favorecido: text('favorecido'),
    cpfCnpjBeneficiario: varchar('cpf_cnpj_beneficiario', { length: 20 }),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    dataVencimento: date('data_vencimento'),
    dataPagamento: date('data_pagamento'),
    /** conta a pagar que este pagamento quita (opcional) */
    contaPagarId: uuid('conta_pagar_id'),
    descricao: text('descricao'),
    status: varchar('status', { length: 20 }).notNull().default('ENVIANDO'),
    statusInter: varchar('status_inter', { length: 40 }),
    /** codigoTransacao (boleto) ou codigoSolicitacao (Pix) no Inter */
    codigoInter: varchar('codigo_inter', { length: 80 }),
    endToEndId: varchar('end_to_end_id', { length: 80 }),
    retorno: jsonb('retorno'),
    erro: text('erro'),
    usuarioId: uuid('usuario_id'),
    usuarioEmail: text('usuario_email'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
    baixadoEm: timestamp('baixado_em', { withTimezone: true }),
    /** Comprovante mandado pro contador por e-mail (dono 23/11/2026). */
    comprovanteContadorEm: timestamp('comprovante_contador_em', { withTimezone: true }),
    comprovanteContadorPara: text('comprovante_contador_para'),
    comprovanteContadorErro: text('comprovante_contador_erro'),
  },
  (t) => ({
    filialIdx: index('idx_conta_consumo_pag_filial').on(t.filialId, t.criadoEm),
    barrasIdx: index('idx_conta_consumo_pag_barras').on(t.codigoBarras),
    statusIdx: index('idx_conta_consumo_pag_status').on(t.status),
  }),
);
