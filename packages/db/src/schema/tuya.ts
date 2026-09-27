// Painel de energia/automação — disjuntores, tomadas e relés Tuya (Wi-Fi)
// cadastrados por filial. Consumo/estado são lidos ao vivo na Tuya Cloud API
// (não são espelhados no banco); esta tabela só guarda o mapeamento
// dispositivo Tuya -> filial/tipo/nome, pra alimentar o painel /energia.

import { pgTable, uuid, varchar, boolean, timestamp, unique, integer, text, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const tuyaDispositivo = pgTable(
  'tuya_dispositivo',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 120 }).notNull(),
    /** entrada | saida | luz | bomba | motor | outro */
    tipo: varchar('tipo', { length: 20 }).notNull().default('outro'),
    tuyaDeviceId: varchar('tuya_device_id', { length: 64 }).notNull(),
    /** código do datapoint de liga/desliga na Tuya — quase sempre switch_1,
     * mas alguns disjuntores/relés usam switch ou switch_led. */
    codigoSwitch: varchar('codigo_switch', { length: 40 }).notNull().default('switch_1'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqFilialDeviceSwitch: unique('uq_tuya_dispositivo_filial_device_switch').on(
      t.filialId,
      t.tuyaDeviceId,
      t.codigoSwitch,
    ),
  }),
);

// Gatilho de alarme -> Tuya. Um sistema externo (ex: alarme do UniFi Protect,
// ação "Webhook") chama /api/energia/alarme/<token>; o sistema liga (ou
// desliga) os dispositivos listados. Se desligarAposMin estiver preenchido,
// o cron /api/cron/alarme-desligar volta o estado depois de N minutos sem
// novo disparo (cada disparo empurra o prazo).
export const alarmeGatilho = pgTable('alarme_gatilho', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
  nome: varchar('nome', { length: 120 }).notNull(),
  /** segredo da URL do webhook — quem tem a URL dispara. */
  token: varchar('token', { length: 64 }).notNull().unique(),
  dispositivoIds: uuid('dispositivo_ids').array().notNull().default(sql`'{}'::uuid[]`),
  /** ligar | desligar */
  acao: varchar('acao', { length: 10 }).notNull().default('ligar'),
  desligarAposMin: integer('desligar_apos_min'),
  /** armado: false = webhook chega mas é ignorado (gerente desarma no painel). */
  ativo: boolean('ativo').notNull().default(true),
  /** quem armou/desarmou por último (email) e quando. */
  ativoAlteradoPor: varchar('ativo_alterado_por', { length: 200 }),
  ativoAlteradoEm: timestamp('ativo_alterado_em', { withTimezone: true }),
  disparos: integer('disparos').notNull().default(0),
  ultimoDisparoEm: timestamp('ultimo_disparo_em', { withTimezone: true }),
  ultimoResultado: text('ultimo_resultado'),
  ultimoPayload: jsonb('ultimo_payload'),
  /** quando o cron deve reverter a ação (null = nada pendente). */
  reverterEm: timestamp('reverter_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});
