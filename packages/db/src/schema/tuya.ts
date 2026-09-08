// Painel de energia/automação — disjuntores, tomadas e relés Tuya (Wi-Fi)
// cadastrados por filial. Consumo/estado são lidos ao vivo na Tuya Cloud API
// (não são espelhados no banco); esta tabela só guarda o mapeamento
// dispositivo Tuya -> filial/tipo/nome, pra alimentar o painel /energia.

import { pgTable, uuid, varchar, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
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
