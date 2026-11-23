// Comprovante de cada pagamento da tela /financeiro/pagar-conta vai pro
// contador por e-mail (dono 23/11/2026: "sempre que for fazer um pagamento,
// mandar o comprovante para o contador"). Marca quando foi (uma vez só) e o
// último erro, pra tentar de novo na próxima conferência.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:comprovante-contador

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE conta_consumo_pagamento ADD COLUMN IF NOT EXISTS comprovante_contador_em timestamptz;
    ALTER TABLE conta_consumo_pagamento ADD COLUMN IF NOT EXISTS comprovante_contador_para text;
    ALTER TABLE conta_consumo_pagamento ADD COLUMN IF NOT EXISTS comprovante_contador_erro text;
  `);
  console.log('conta_consumo_pagamento: comprovante_contador_* OK');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
