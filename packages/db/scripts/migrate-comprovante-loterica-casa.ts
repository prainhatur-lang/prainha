// Comprovantes da lotérica: coluna casa_escolhida — a casa que o usuário diz
// que o depósito é (quem trabalha em várias casas tem 10% em cada uma).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:comprovante-loterica-casa

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE comprovante_loterica
      ADD COLUMN IF NOT EXISTS casa_escolhida uuid REFERENCES filial(id) ON DELETE SET NULL
  `);
  console.log('ok: comprovante_loterica.casa_escolhida');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
