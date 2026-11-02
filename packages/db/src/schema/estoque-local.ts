// Setores (locais) de estoque dentro da casa + transferência entre eles
// (02/11/2026, pedido do dono: "vai sair do depósito, vai para onde? E
// informar quem é a pessoa... tirar a foto da pessoa que fez").
//
// Não mexe no saldo da casa (`produto.estoque_atual` e `movimento_estoque`
// continuam iguais): transferir só muda ONDE o produto está. A conta de
// quanto tem em cada setor fica em apps/web/src/lib/estoque-local.ts.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  numeric,
  boolean,
  integer,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { produto } from './vendas';
import { funcionario } from './rh';

/** Setor de estoque da casa (Depósito, Recepção, Bar, Cozinha...).
 *  `principal` = onde cai tudo que não foi transferido (compra, ajuste,
 *  produção). Um por casa. */
export const estoqueLocal = pgTable(
  'estoque_local',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 60 }).notNull(),
    ordem: integer('ordem').notNull().default(0),
    principal: boolean('principal').notNull().default(false),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqNome: unique('uq_estoque_local_nome').on(t.filialId, t.nome),
    filialIdx: index('idx_estoque_local_filial').on(t.filialId, t.ordem),
  }),
);

/** Transferência de um produto de um setor pra outro, com quem levou e a
 *  foto da pessoa tirada na hora. Cancelar só marca (não apaga). */
export const estoqueTransferenciaLocal = pgTable(
  'estoque_transferencia_local',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id, { onDelete: 'cascade' }),
    /** Na unidade de estoque do produto. Sempre positiva. */
    quantidade: numeric('quantidade', { precision: 14, scale: 4 }).notNull(),
    /** Unidade no momento (foto do cadastro, pro histórico). */
    unidade: varchar('unidade', { length: 10 }),
    localOrigemId: uuid('local_origem_id')
      .notNull()
      .references(() => estoqueLocal.id, { onDelete: 'restrict' }),
    localDestinoId: uuid('local_destino_id')
      .notNull()
      .references(() => estoqueLocal.id, { onDelete: 'restrict' }),
    /** Quem fez (funcionário da casa). Null quando foi digitado o nome. */
    funcionarioId: uuid('funcionario_id').references(() => funcionario.id, { onDelete: 'set null' }),
    /** Nome de quem fez, gravado sempre (mesmo com funcionarioId). */
    pessoaNome: varchar('pessoa_nome', { length: 200 }).notNull(),
    /** Foto da pessoa no bucket privado `estoque-transferencia-fotos`. */
    fotoPath: text('foto_path'),
    observacao: text('observacao'),
    /** Hora da transferência. */
    dataHora: timestamp('data_hora', { withTimezone: true }).notNull().defaultNow(),
    /** Usuário logado que lançou. */
    criadoPor: uuid('criado_por'),
    criadoPorEmail: text('criado_por_email'),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    canceladaPor: text('cancelada_por'),
    motivoCancelamento: text('motivo_cancelamento'),
  },
  (t) => ({
    filialDataIdx: index('idx_estoque_transf_local_data').on(t.filialId, t.dataHora),
    produtoIdx: index('idx_estoque_transf_local_produto').on(t.filialId, t.produtoId),
  }),
);
