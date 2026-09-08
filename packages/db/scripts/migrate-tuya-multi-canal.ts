// Painel de energia Tuya: permite cadastrar mais de um canal/switch (ex:
// interruptor de 4 seções -> switch_1..switch_4) do MESMO dispositivo físico
// na mesma filial. Troca a unique key de (filial_id, tuya_device_id) pra
// (filial_id, tuya_device_id, codigo_switch). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:tuya-multi-canal

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  try {
    const r = await fn();
    console.log('OK');
    return r;
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function main() {
  await run('drop constraint antiga (se existir)', () =>
    sql`ALTER TABLE tuya_dispositivo DROP CONSTRAINT IF EXISTS uq_tuya_dispositivo_filial_device`,
  );
  await run('nova constraint (filial, device, switch)', () =>
    sql`
      ALTER TABLE tuya_dispositivo
      ADD CONSTRAINT uq_tuya_dispositivo_filial_device_switch
        UNIQUE (filial_id, tuya_device_id, codigo_switch)
    `.catch((e) => {
      if (e.code === '42710') return; // já existe
      throw e;
    }),
  );

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
