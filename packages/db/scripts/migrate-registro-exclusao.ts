// Registro de exclusão (quem apagou, quando, motivo e a foto do que foi
// apagado). Pedido do dono em 20/10/2026: a conta de R$ 667 da Hortifruti
// Itabaiana (Prainha Mar) foi excluída e não havia como saber por quem.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:registro-exclusao

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS registro_exclusao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid,
      tabela varchar(40) NOT NULL,
      registro_id uuid NOT NULL,
      resumo text,
      motivo text,
      usuario_id uuid,
      usuario_email text,
      dados jsonb,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_registro_exclusao_filial ON registro_exclusao (filial_id, criado_em)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_registro_exclusao_registro ON registro_exclusao (registro_id)`);
  await sql.unsafe(`ALTER TABLE registro_exclusao ENABLE ROW LEVEL SECURITY`);
  console.log('ok: registro_exclusao (RLS ligado)');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
