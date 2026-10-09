// Cliente VIP — cartão liberado da trava de funcionário:
//   · fidelidade_cartao.funcionario_liberado: exceção do dono à regra
//     "funcionário não usa o cartão"
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fidelidade-funcionario-liberado

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`ALTER TABLE fidelidade_cartao ADD COLUMN IF NOT EXISTS funcionario_liberado boolean NOT NULL DEFAULT false`;
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
