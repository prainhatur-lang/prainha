// Modulo de Permissoes (RBAC).
//
// Modelo:
//   permissao       (catalogo fixo: codigo unico tipo 'cotacao.create')
//        |
//   grupo_permissao (N:N)
//        |
//   grupo_usuario   (pre-prontos do sistema OU custom da organizacao)
//        |
//   usuario_grupo   (usuario pertence a grupos, com escopo filial opcional)
//
// Roles antigos (DONO/GERENTE/COMPRAS/FINANCEIRO) em usuario_filial continuam
// existindo por compatibilidade. Migrados pra grupos equivalentes via seed.

import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  unique,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { usuario, organizacao, filial } from './tenant';

/** Catalogo fixo de permissoes do sistema. Populado via seed. Codigo unico
 *  no formato '<modulo>.<acao>' — ex: 'cotacao.create', 'fornecedor.update'. */
export const permissao = pgTable(
  'permissao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Ex: 'cotacao.create', 'pedido_compra.aprovar'. */
    codigo: varchar('codigo', { length: 60 }).notNull().unique(),
    /** Modulo logico: 'cotacao', 'fornecedor', 'conta_pagar', ... */
    modulo: varchar('modulo', { length: 30 }).notNull(),
    /** Acao: 'read' | 'create' | 'update' | 'delete' | <especial>. */
    acao: varchar('acao', { length: 30 }).notNull(),
    /** Descricao humano-friendly. */
    descricao: text('descricao'),
    /** Escopo: 'filial' (escopada por filial) ou 'organizacao' (global da org). */
    escopo: varchar('escopo', { length: 20 }).notNull().default('filial'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    moduloIdx: index('idx_permissao_modulo').on(t.modulo),
  }),
);

/** Grupos de usuario. Sistema=true significa grupo pre-pronto que nao pode
 *  ser editado/deletado pelo usuario final (Admin, Gerente, Comprador, etc.).
 *  Sistema=false sao grupos custom criados por gestores. */
export const grupoUsuario = pgTable(
  'grupo_usuario',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Null pra grupos do sistema (compartilhados por todas as orgs). */
    organizacaoId: uuid('organizacao_id').references(() => organizacao.id, {
      onDelete: 'cascade',
    }),
    nome: varchar('nome', { length: 80 }).notNull(),
    descricao: text('descricao'),
    /** True = pre-pronto do sistema (Admin, Gerente, etc). Imutavel pelo gestor. */
    sistema: boolean('sistema').notNull().default(false),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqNome: unique('uq_grupo_org_nome').on(t.organizacaoId, t.nome),
    orgIdx: index('idx_grupo_org').on(t.organizacaoId),
  }),
);

/** Liga grupo a permissao (N:N). */
export const grupoPermissao = pgTable(
  'grupo_permissao',
  {
    grupoId: uuid('grupo_id')
      .notNull()
      .references(() => grupoUsuario.id, { onDelete: 'cascade' }),
    permissaoId: uuid('permissao_id')
      .notNull()
      .references(() => permissao.id, { onDelete: 'cascade' }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.grupoId, t.permissaoId] }),
    permIdx: index('idx_grp_perm_perm').on(t.permissaoId),
  }),
);

/** Usuario pertence a grupos. filial_id opcional = grupo vale so naquela filial.
 *  Se null = vale em todas as filiais que o user tem acesso (via usuario_filial). */
export const usuarioGrupo = pgTable(
  'usuario_grupo',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    grupoId: uuid('grupo_id')
      .notNull()
      .references(() => grupoUsuario.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'cascade' }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqUserGrupoFilial: unique('uq_user_grupo_filial').on(t.usuarioId, t.grupoId, t.filialId),
    userIdx: index('idx_user_grupo_user').on(t.usuarioId),
    grupoIdx: index('idx_user_grupo_grupo').on(t.grupoId),
  }),
);
