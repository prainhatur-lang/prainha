// Vale transporte: coluna vt_quinzena_item.conta_pagar_id — a conta a pagar
// gerada ao gravar a quinzena como paga (o comprovante da lotérica casa com ela).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:vt-conta-pagar

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE vt_quinzena_item
      ADD COLUMN IF NOT EXISTS conta_pagar_id uuid REFERENCES conta_pagar(id) ON DELETE SET NULL
  `);
  console.log('ok: vt_quinzena_item.conta_pagar_id');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
