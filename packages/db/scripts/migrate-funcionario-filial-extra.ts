// Quem circula entre lojas (ex: segunda na Prainha Bar, terça na Prainha
// Mar) — filial ADICIONAL além da lotação principal de `funcionario`. Uma
// pessoa, um cadastro, um rosto — nunca duplica por loja.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:funcionario-filial-extra

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS funcionario_filial_extra (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      funcionario_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      criado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_funcionario_filial_extra ON funcionario_filial_extra (funcionario_id, filial_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_funcionario_filial_extra_filial ON funcionario_filial_extra (filial_id)`);
  await sql.unsafe(`ALTER TABLE funcionario_filial_extra ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] funcionario_filial_extra pronta');
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
