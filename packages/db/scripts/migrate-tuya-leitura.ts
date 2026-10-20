// Leitura de hora em hora dos dispositivos Tuya (consumo e média; o contador
// do disjuntor zera quando falta luz). Tabela tuya_leitura. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:tuya-leitura

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
  await run('tuya_leitura', () =>
    sql`
      CREATE TABLE IF NOT EXISTS tuya_leitura (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        dispositivo_id uuid NOT NULL REFERENCES tuya_dispositivo(id) ON DELETE CASCADE,
        lido_em timestamptz NOT NULL DEFAULT now(),
        online boolean NOT NULL,
        ligado boolean,
        potencia_w numeric(10,1),
        tensao_v numeric(6,1),
        corrente_a numeric(8,3),
        contador_kwh numeric(12,2),
        consumo_kwh numeric(10,3),
        zerou boolean NOT NULL DEFAULT false,
        erro text
      )
    `,
  );
  await run('idx tuya_leitura dispositivo/lido_em', () =>
    sql`CREATE INDEX IF NOT EXISTS tuya_leitura_disp_lido_idx ON tuya_leitura (dispositivo_id, lido_em)`,
  );
  await run('RLS tuya_leitura', () => sql.unsafe(`ALTER TABLE tuya_leitura ENABLE ROW LEVEL SECURITY`));

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
