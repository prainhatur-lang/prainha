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

import { pgTable, uuid, varchar, timestamp, text, date, numeric, integer, index, jsonb } from 'drizzle-orm/pg-core';
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
    /** 'credito' (crédito de consumo no fiado — o de sempre) | 'receber'
     *  (parceiro deve: lança no fiado a prazo) | 'pagar' (casa deve: vira
     *  conta a pagar). 04/11/2026. */
    tipo: varchar('tipo', { length: 10 }).notNull().default('credito'),
    /** Todas as fotos/arquivos do contrato [{path, nome}] (o 1º também fica em arquivoPath). */
    arquivos: jsonb('arquivos').$type<Array<{ path: string; nome: string }>>(),
    /** Parcelas do contrato [{data: 'YYYY-MM-DD', valor}] — pagar/receber. */
    vencimentos: jsonb('vencimentos').$type<Array<{ data: string; valor: number }>>(),
    /** Crédito liberado aos poucos (11/11/2026): nº de meses. null = tudo de
     *  uma vez, como sempre. Só tipo 'credito'. Parcelas em permuta_liberacao. */
    liberacaoMeses: integer('liberacao_meses'),
    /** Dia da 1ª liberação (as outras caem no mesmo dia dos meses seguintes). */
    liberacaoInicio: date('liberacao_inicio'),
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
    /** 'aguardando_cadastro' | 'lancado' | 'erro' | 'cancelado' | 'mensal'
     *  (cadastro pronto; o crédito sai mês a mês por permuta_liberacao) */
    status: varchar('status', { length: 24 }).notNull().default('aguardando_cadastro'),
    clienteCodigoExterno: integer('cliente_codigo_externo'),
    /** criar_cliente pedido à loja (quando o parceiro não existia lá). */
    agenteComandoId: uuid('agente_comando_id'),
    fiadoLancamentoId: uuid('fiado_lancamento_id'),
    /** tipo 'pagar': contas a pagar criadas nesta casa (uma por parcela). */
    contaPagarIds: jsonb('conta_pagar_ids').$type<string[]>(),
    erro: text('erro'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    lancadoEm: timestamp('lancado_em', { withTimezone: true }),
  },
  (t) => ({
    porContrato: index('idx_permuta_credito_contrato').on(t.contratoId),
    porStatus: index('idx_permuta_credito_status').on(t.status),
  }),
);

// Liberação mensal do crédito (dono, 11/11/2026: contrato de R$ 2.500/mês por
// 12 meses não pode entrar inteiro no PDV). Uma linha por casa e por mês; no
// dia, vira um PAGAMENTO no fiado do parceiro (forma 20), igual ao crédito de
// uma vez só. Regra em apps/web/src/lib/permuta.ts (processarLiberacoes).
export const permutaLiberacao = pgTable(
  'permuta_liberacao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    creditoId: uuid('credito_id').notNull().references(() => permutaCredito.id, { onDelete: 'cascade' }),
    contratoId: uuid('contrato_id').notNull().references(() => permutaContrato.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** 1..N */
    numero: integer('numero').notNull(),
    data: date('data').notNull(),
    valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
    /** 'agendada' | 'lancada' | 'cancelada' */
    status: varchar('status', { length: 12 }).notNull().default('agendada'),
    fiadoLancamentoId: uuid('fiado_lancamento_id'),
    lancadoEm: timestamp('lancado_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    porCredito: index('idx_permuta_liberacao_credito').on(t.creditoId),
    porStatus: index('idx_permuta_liberacao_status').on(t.status, t.data),
  }),
);
