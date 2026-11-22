// Conta do Mercado Livre (comprador) ligada ao sistema: ml_conta.
// Tokens cifrados com CREDENCIAL_SECRET (lib/segredo).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:mercadolivre

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ml_conta (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ml_user_id bigint NOT NULL UNIQUE,
      nickname varchar(120),
      email varchar(200),
      access_token_cifrado text NOT NULL,
      refresh_token_cifrado text NOT NULL,
      expira_em timestamptz NOT NULL,
      ligado_por uuid,
      ligado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      ultimo_erro text
    )
  `);
  await sql.unsafe(`ALTER TABLE ml_conta ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] ml_conta pronta');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
