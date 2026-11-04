// Permuta (04/11/2026): o contrato pode virar crédito (como antes), conta a
// receber (fiado a prazo) ou conta a pagar; várias fotos/arquivos por contrato.
// Só colunas novas, com default que mantém o comportamento antigo.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:permuta-tipo

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE permuta_contrato ADD COLUMN IF NOT EXISTS tipo varchar(10) NOT NULL DEFAULT 'credito';
    ALTER TABLE permuta_contrato ADD COLUMN IF NOT EXISTS arquivos jsonb;
    ALTER TABLE permuta_contrato ADD COLUMN IF NOT EXISTS vencimentos jsonb;
    ALTER TABLE permuta_credito ADD COLUMN IF NOT EXISTS conta_pagar_ids jsonb;
  `);
  console.log('ok: permuta_contrato.tipo/arquivos/vencimentos + permuta_credito.conta_pagar_ids');
  await sql.end();
}
main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
