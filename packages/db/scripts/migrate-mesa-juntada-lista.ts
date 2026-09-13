// reserva.mesa_juntada vira LISTA (várias mesas extras separadas por vírgula,
// ex: "13,14") — a recepção junta 3+ mesas pra grupo grande. Só alarga a
// coluna (20 → 100); o conteúdo antigo (uma mesa) continua válido.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:mesa-juntada-lista

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function run(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${label}... `);
  await fn();
  console.log('OK');
}

async function main() {
  console.log('[1] reserva.mesa_juntada → varchar(100)');
  await run('alter column', () => sql`ALTER TABLE reserva ALTER COLUMN mesa_juntada TYPE varchar(100)`);
  console.log('pronto.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sql.end());
