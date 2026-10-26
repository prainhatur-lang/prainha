// RH: documento de saída (TRCT / recibo de acerto) vira conta a pagar da
// rescisão. funcionario_documento.conta_pagar_id liga o arquivo à conta criada
// (trava lançar duas vezes) e .dados guarda o que a IA leu do termo.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:funcionario-documento-conta

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE funcionario_documento
      ADD COLUMN IF NOT EXISTS conta_pagar_id uuid REFERENCES conta_pagar(id) ON DELETE SET NULL
  `);
  await sql.unsafe(`ALTER TABLE funcionario_documento ADD COLUMN IF NOT EXISTS dados jsonb`);
  console.log('ok: funcionario_documento.conta_pagar_id + dados');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
