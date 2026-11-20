// Água do Prainha — caixas, bombas dos poços e de recalque, alarmes e comandos.
// Um quadro físico só (3 poços + bomba 4, caixas térrea/intermediária/superior),
// por isso as tabelas não têm filial_id: o acesso é pela permissão `agua.read`.
// Nomes iguais aos do pacote "concilia agua" (01_agua_schema.sql).
// O banco que VALE é o do servidor da loja (Concilia Loja): a placa grava lá e
// tudo funciona sem internet. Estas tabelas são a CÓPIA, alimentada por
// /api/loja/agua a cada minuto.
// Migrations: packages/db/scripts/migrate-agua.ts e migrate-agua-replica.ts

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const aguaBombas = pgTable('agua_bombas', {
  /** 1, 2, 3 = poços; 4 = bomba de recalque. */
  id: smallint('id').primaryKey(),
  nome: text('nome').notNull(),
  fases: text('fases'),
  correnteNominal: numeric('corrente_nominal', { precision: 5, scale: 2 }),
  limiteCorrenteBaixa: numeric('limite_corrente_baixa', { precision: 5, scale: 2 }),
  /** ID Tuya do disjuntor inteligente da bomba. */
  tuyaDeviceId: text('tuya_device_id'),
  liberada: boolean('liberada').notNull().default(true),
  /** auto | manual | off (posição da chave do quadro). */
  modo: text('modo').notNull().default('auto'),
  /** poco_seco | tubo_fechado | sobrecarga. */
  falha: text('falha'),
  tentativas: smallint('tentativas').notNull().default(0),
  proximaTentativa: timestamp('proxima_tentativa', { withTimezone: true }),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Uma linha por leitura (a placa grava a cada minuto). */
export const aguaLeituras = pgTable(
  'agua_leituras',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    /** Id da leitura no servidor da loja (a nuvem é cópia; reenvio não duplica). */
    idLocal: bigint('id_local', { mode: 'number' }),
    /** Níveis em percentual. */
    nivelTerrea: numeric('nivel_terrea', { precision: 5, scale: 1 }),
    nivelIntermediaria: numeric('nivel_intermediaria', { precision: 5, scale: 1 }),
    nivelSuperior: numeric('nivel_superior', { precision: 5, scale: 1 }),
    /** Pressões em bar: antes do filtro 1, entre os filtros, depois do filtro 2. */
    pressao1: numeric('pressao_1', { precision: 5, scale: 2 }),
    pressao2: numeric('pressao_2', { precision: 5, scale: 2 }),
    pressao3: numeric('pressao_3', { precision: 5, scale: 2 }),
    /** Corrente em ampères, por bomba. */
    corrente1: numeric('corrente_1', { precision: 5, scale: 2 }),
    corrente2: numeric('corrente_2', { precision: 5, scale: 2 }),
    corrente3: numeric('corrente_3', { precision: 5, scale: 2 }),
    corrente4: numeric('corrente_4', { precision: 5, scale: 2 }),
    v1Aberta: boolean('v1_aberta'),
    v2Aberta: boolean('v2_aberta'),
  },
  (t) => [
    index('agua_leituras_criado_em').on(t.criadoEm.desc()),
    uniqueIndex('agua_leituras_id_local').on(t.idLocal),
  ],
);

export const aguaConfig = pgTable('agua_config', {
  chave: text('chave').primaryKey(),
  valor: numeric('valor').notNull(),
  descricao: text('descricao'),
});

export const aguaAlarmes = pgTable('agua_alarmes', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  codigo: text('codigo').notNull(),
  /** critico (aviso em tela cheia) | aviso. */
  gravidade: text('gravidade').notNull(),
  titulo: text('titulo').notNull(),
  detalhe: text('detalhe'),
  bombaId: smallint('bomba_id').references(() => aguaBombas.id),
  abertoEm: timestamp('aberto_em', { withTimezone: true }).notNull().defaultNow(),
  vistoEm: timestamp('visto_em', { withTimezone: true }),
  vistoPor: uuid('visto_por'),
  resolvidoEm: timestamp('resolvido_em', { withTimezone: true }),
});

export const aguaComandos = pgTable('agua_comandos', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  /** liberar | bloquear | rearmar | retrolavar | abrir_v1 | abrir_v2. */
  tipo: text('tipo').notNull(),
  bombaId: smallint('bomba_id').references(() => aguaBombas.id),
  solicitadoPor: uuid('solicitado_por'),
  executadoEm: timestamp('executado_em', { withTimezone: true }),
  resultado: text('resultado'),
});

export const aguaRetrolavagens = pgTable('agua_retrolavagens', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  iniciadoEm: timestamp('iniciado_em', { withTimezone: true }).notNull().default(sql`now()`),
  terminadoEm: timestamp('terminado_em', { withTimezone: true }),
  resultado: text('resultado'),
  nivelTerreaAntes: numeric('nivel_terrea_antes', { precision: 5, scale: 1 }),
  nivelTerreaDepois: numeric('nivel_terrea_depois', { precision: 5, scale: 1 }),
});
