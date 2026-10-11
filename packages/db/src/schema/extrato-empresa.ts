// Extrato bancário de EMPRESA QUE PAGA PESSOAL e não é uma das casas — hoje a
// E.B. SERVICOS LTDA (terceirizada que registra a maior parte da equipe).
//
// Fica fora de `lancamento_banco` de propósito: aquela tabela é por filial e
// alimenta a conciliação de recebíveis e o financeiro da casa; o extrato de
// outra empresa lá dentro entraria nessas contas. Aqui é só REGISTRO do que
// o banco devolveu, pra conferir a folha do contador pessoa por pessoa
// (/rh/folha-contador/pagamentos). Nada aqui gera conta, baixa ou lançamento.
//
// Entra pela API do Inter (lib/extrato-empresa.ts), com a credencial
// `INTER_<EMPRESA>_*` — só leitura (escopo extrato.read).

import { pgTable, uuid, varchar, timestamp, numeric, index, unique, text, date, char } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const extratoEmpresa = pgTable(
  'extrato_empresa',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Sigla da empresa dona da conta. Hoje só 'EB'. */
    empresa: varchar('empresa', { length: 20 }).notNull(),
    dataMovimento: date('data_movimento').notNull(),
    /** C = crédito, D = débito */
    tipo: char('tipo', { length: 1 }).notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    /** tipoTransacao do Inter: PIX, PAGAMENTO, TRANSFERENCIA... */
    codigoHistorico: varchar('codigo_historico', { length: 30 }),
    titulo: text('titulo'),
    /** Descrição inteira (em lancamento_banco ela é cortada em 100). */
    descricao: text('descricao'),
    idTransacao: varchar('id_transacao', { length: 50 }).notNull(),
    importadoEm: timestamp('importado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    empresaDataIdx: index('idx_extrato_empresa_data').on(t.empresa, t.dataMovimento),
    unico: unique('uq_extrato_empresa').on(t.empresa, t.dataMovimento, t.tipo, t.valor, t.idTransacao),
  }),
);
