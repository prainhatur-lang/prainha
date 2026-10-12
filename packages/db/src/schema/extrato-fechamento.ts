// Extratos bancários do FECHAMENTO DO MÊS — o arquivo do banco (PDF, OFX,
// planilha) guardado por conta e por mês, pro contador ver a apuração e baixar
// o extrato no mesmo lugar (/relatorios/fechamento).
//
// Fica fora de `conta_bancaria`/`lancamento_banco` de propósito: aquelas
// alimentam a conciliação e o dashboard do fechamento (uma conta nova lá
// apareceria como "extrato importado" sem ter lançamento). Aqui é só o
// DOCUMENTO: nada é lido, somado, conciliado ou lançado a partir dele.
//
// `extrato_conta` = de quais contas o extrato é pedido todo mês. A conta é de
// uma casa (filial_id) ou de empresa do grupo que não é uma das casas (filial_id
// nulo + `empresa`, ex.: Leles, E.B. Serviços).

import { pgTable, uuid, varchar, timestamp, integer, boolean, text, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizacao, filial, usuario } from './tenant';

export const extratoConta = pgTable(
  'extrato_conta',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizacaoId: uuid('organizacao_id')
      .notNull()
      .references(() => organizacao.id, { onDelete: 'cascade' }),
    /** Casa dona da conta. Nulo = empresa do grupo que não é uma das casas. */
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'cascade' }),
    /** Nome da empresa dona da conta quando não é uma das casas. */
    empresa: varchar('empresa', { length: 80 }),
    banco: varchar('banco', { length: 60 }).notNull(),
    /** Detalhe opcional pra separar duas contas do mesmo banco (ex.: "aplicação"). */
    apelido: varchar('apelido', { length: 80 }),
    ordem: integer('ordem').notNull().default(0),
    /** false = não pedir mais (conta encerrada). Meses com arquivo seguem aparecendo. */
    ativo: boolean('ativo').notNull().default(true),
    criadoPor: uuid('criado_por').references(() => usuario.id),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('idx_extrato_conta_org').on(t.organizacaoId),
  }),
);

export const extratoArquivo = pgTable(
  'extrato_arquivo',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    contaId: uuid('conta_id')
      .notNull()
      .references(() => extratoConta.id, { onDelete: 'cascade' }),
    ano: integer('ano').notNull(),
    mes: integer('mes').notNull(),
    nomeOriginal: text('nome_original').notNull(),
    /** Caminho no bucket privado `extratos-fechamento`. */
    storagePath: text('storage_path').notNull().unique(),
    contentType: varchar('content_type', { length: 120 }),
    tamanhoBytes: integer('tamanho_bytes'),
    enviadoPor: uuid('enviado_por').references(() => usuario.id),
    enviadoEm: timestamp('enviado_em', { withTimezone: true }).notNull().defaultNow(),
    /** Retirado da lista (arquivo errado). O arquivo continua no bucket. */
    excluidoEm: timestamp('excluido_em', { withTimezone: true }),
    excluidoPor: uuid('excluido_por').references(() => usuario.id),
  },
  (t) => ({
    contaMesIdx: index('idx_extrato_arquivo_conta_mes').on(t.contaId, t.ano, t.mes),
  }),
);
