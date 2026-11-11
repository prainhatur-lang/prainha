// Empréstimo (mútuo) entre empresas do sistema — pedido do dono 11/11/2026:
// "a EB Serviços vai emprestar dinheiro para outra loja e depois tem que
// retornar esse dinheiro. É empréstimo de mútuo."
//
// Vive em cima do contas a pagar. Cada mútuo gera duas contas origem='MUTUO':
//   - na CREDORA (quem empresta): a saída do dinheiro, tendo a devedora como
//     fornecedor — paga por Pix/transferência como qualquer conta;
//   - na DEVEDORA (quem recebeu): a devolução, tendo a credora como fornecedor,
//     com vencimento na data combinada. Cada devolução (inteira ou em partes)
//     é uma baixa nessa conta; o saldo do mútuo é o saldo dela.
// Empréstimo e devolução não são despesa: origem MUTUO fica fora do resultado
// do fechamento (lib/fechamento-dashboard).

import { sql } from 'drizzle-orm';
import { date, index, numeric, pgTable, serial, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { filial } from './tenant';

export const mutuo = pgTable(
  'mutuo',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    numero: serial('numero').notNull(),
    /** Quem empresta (de onde o dinheiro sai) */
    filialCredoraId: uuid('filial_credora_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Quem recebe e depois devolve */
    filialDevedoraId: uuid('filial_devedora_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Dia em que o dinheiro foi (ou vai ser) emprestado (BRT) */
    data: date('data').notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    /** Data combinada pra devolver */
    dataDevolucao: date('data_devolucao').notNull(),
    observacao: text('observacao'),
    /** Conta a pagar na CREDORA = saída do dinheiro (uuid raw — evita ciclo de import) */
    contaSaidaId: uuid('conta_saida_id'),
    /** Conta a pagar na DEVEDORA = devolução */
    contaDevolucaoId: uuid('conta_devolucao_id'),
    /** ATIVO | CANCELADO (quitado se lê do saldo da conta de devolução) */
    status: varchar('status', { length: 12 }).notNull().default('ATIVO'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    canceladoPor: uuid('cancelado_por'),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoMotivo: text('cancelado_motivo'),
  },
  (t) => ({
    credoraIdx: index('idx_mutuo_credora').on(t.filialCredoraId),
    devedoraIdx: index('idx_mutuo_devedora').on(t.filialDevedoraId),
  }),
);
