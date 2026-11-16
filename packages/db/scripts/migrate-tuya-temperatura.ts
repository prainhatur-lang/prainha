// Histórico de temperatura/umidade do ambiente: o cron de hora em hora passa
// a gravar também os sensores de temperatura (aparelho infravermelho Tuya).
// Só acrescenta 2 colunas em tuya_leitura. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:tuya-temperatura

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
  await run('tuya_leitura.temperatura_c', () =>
    sql`ALTER TABLE tuya_leitura ADD COLUMN IF NOT EXISTS temperatura_c numeric(5,1)`,
  );
  await run('tuya_leitura.umidade_pct', () =>
    sql`ALTER TABLE tuya_leitura ADD COLUMN IF NOT EXISTS umidade_pct numeric(5,1)`,
  );
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
