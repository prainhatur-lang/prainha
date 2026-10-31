// Permuta / parceria comercial (pedido do dono 31/10/2026): a empresa parceira
// entrega serviço/produto e em troca ganha CRÉDITO pra consumir nas casas
// (ex.: R$ 2.500, metade no Prainha Bar e metade no Prainha Mar).
//
// Um contrato (com o PDF) e uma linha de crédito por casa. O crédito vira um
// PAGAMENTO na conta corrente (fiado) do parceiro na loja: saldo negativo =
// crédito a consumir (mesmo jeito da permuta da Pinheiro Vigilância, 07/10).
// O parceiro não precisa existir antes: o cadastro é pedido à loja pela fila
// `agente_comando` (criar_cliente) e o crédito sai quando ela devolve o código.
// Regra em apps/web/src/lib/permuta.ts.

import { pgTable, uuid, varchar, timestamp, text, date, numeric, integer, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial, organizacao } from './tenant';

export const permutaContrato = pgTable(
  'permuta_contrato',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizacaoId: uuid('organizacao_id').notNull().references(() => organizacao.id, { onDelete: 'cascade' }),
    parceiroNome: text('parceiro_nome').notNull(),
    /** CPF ou CNPJ, só dígitos. */
    documento: varchar('documento', { length: 14 }),
    contato: text('contato'),
    telefone: varchar('telefone', { length: 30 }),
    email: text('email'),
    valorTotal: numeric('valor_total', { precision: 12, scale: 2 }).notNull(),
    /** O que o parceiro entrega em troca (serviço, produto, divulgação…). */
    contrapartida: text('contrapartida'),
    dataInicio: date('data_inicio'),
    dataFim: date('data_fim'),
    observacao: text('observacao'),
    arquivoPath: text('arquivo_path'),
    arquivoNome: varchar('arquivo_nome', { length: 200 }),
    criadoPor: text('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoPor: text('cancelado_por'),
    canceladoMotivo: text('cancelado_motivo'),
  },
  (t) => ({
    porOrg: index('idx_permuta_contrato_org').on(t.organizacaoId, t.criadoEm),
  }),
);

export const permutaCredito = pgTable(
  'permuta_credito',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    contratoId: uuid('contrato_id').notNull().references(() => permutaContrato.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
    /** 'aguardando_cadastro' | 'lancado' | 'erro' | 'cancelado' */
    status: varchar('status', { length: 24 }).notNull().default('aguardando_cadastro'),
    clienteCodigoExterno: integer('cliente_codigo_externo'),
    /** criar_cliente pedido à loja (quando o parceiro não existia lá). */
    agenteComandoId: uuid('agente_comando_id'),
    fiadoLancamentoId: uuid('fiado_lancamento_id'),
    erro: text('erro'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    lancadoEm: timestamp('lancado_em', { withTimezone: true }),
  },
  (t) => ({
    porContrato: index('idx_permuta_credito_contrato').on(t.contratoId),
    porStatus: index('idx_permuta_credito_status').on(t.status),
  }),
);
