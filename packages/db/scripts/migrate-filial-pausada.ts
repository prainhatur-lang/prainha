// ALTER filial ADD pausada_em (timestamp) + pausada_motivo (varchar).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:filial-pausada

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER filial ADD pausada_em... ');
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS pausada_em timestamp with time zone`;
  console.log('OK');
  process.stdout.write('  ALTER filial ADD pausada_motivo... ');
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS pausada_motivo varchar(200)`;
  console.log('OK');

  // Marca Prainha Mar 0003 como pausada (loja fechada até julho)
  process.stdout.write("  Marcando 'Prainha Mar 0003' como pausada ate julho... ");
  const r = await sql<Array<{ id: string }>>`
    UPDATE filial
    SET pausada_em = now(),
        pausada_motivo = 'Loja fechada — reabre em julho/2026'
    WHERE nome ILIKE '%Prainha Mar%'
      AND pausada_em IS NULL
    RETURNING id
  `;
  console.log(`OK — ${r.length} filial(is) atualizada(s)`);

  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
