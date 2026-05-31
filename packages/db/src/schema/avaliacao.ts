// Avaliacoes de clientes (reputacao).
//
// Fluxo: cliente abre /avaliar/[token] (publico, via QR na mesa/conta) e da uma
// nota de 1 a 5. A pagina faz o "gating" pela filial.notaCorteGoogle:
//   - nota >= corte  -> convida a publicar no Google (link em filial.googleReviewUrl)
//   - nota <  corte  -> captura nome + whatsapp + comentario pra equipe resolver
//
// Toda avaliacao (alta ou baixa) eh gravada aqui. As baixas entram no painel
// interno /avaliacoes com workflow de status (novo -> em_contato -> resolvido).

import { pgTable, uuid, text, timestamp, varchar, integer, boolean, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const avaliacao = pgTable(
  'avaliacao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Nota de 1 a 5 estrelas. */
    nota: integer('nota').notNull(),
    /** Comentario livre do cliente (opcional). */
    comentario: text('comentario'),
    /** Nome do cliente — coletado quando a nota eh baixa. */
    nome: varchar('nome', { length: 200 }),
    /** WhatsApp/telefone do cliente — coletado quando a nota eh baixa, pra
     *  equipe entrar em contato. So digitos. */
    whatsapp: varchar('whatsapp', { length: 30 }),
    /** Origem da avaliacao: identifica mesa/garcom/etc. Vem do parametro `o`
     *  no link do QR (ex: "mesa-12", "garcom-joao"). Null = QR generico da filial. */
    origem: varchar('origem', { length: 100 }),
    /** True se o cliente foi direcionado a publicar no Google (nota >= corte). */
    foiPraGoogle: boolean('foi_pra_google').notNull().default(false),
    /** Workflow das avaliacoes baixas: novo | em_contato | resolvido.
     *  As altas (foiPraGoogle) nascem 'resolvido' — nao precisam de acao. */
    status: varchar('status', { length: 20 }).notNull().default('novo'),
    /** Notas internas da equipe sobre o atendimento ao cliente. */
    observacaoInterna: text('observacao_interna'),
    /** Usuario que resolveu/atendeu (auth.users id). */
    resolvidoPor: uuid('resolvido_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialStatusIdx: index('avaliacao_filial_status_idx').on(t.filialId, t.status),
    filialCriadoIdx: index('avaliacao_filial_criado_idx').on(t.filialId, t.criadoEm),
  }),
);
