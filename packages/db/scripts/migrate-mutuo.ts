// Empréstimo (mútuo) entre empresas do sistema (/financeiro/emprestimos).
// Ver packages/db/src/schema/mutuo.ts. Pedido do dono 11/11/2026.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:mutuo

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS mutuo (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      numero serial NOT NULL,
      filial_credora_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      filial_devedora_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      data date NOT NULL,
      valor numeric(14,2) NOT NULL,
      data_devolucao date NOT NULL,
      observacao text,
      conta_saida_id uuid,
      conta_devolucao_id uuid,
      status varchar(12) NOT NULL DEFAULT 'ATIVO',
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      cancelado_por uuid,
      cancelado_em timestamptz,
      cancelado_motivo text
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_mutuo_credora ON mutuo (filial_credora_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_mutuo_devedora ON mutuo (filial_devedora_id)`);
  await sql.unsafe(`ALTER TABLE mutuo ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] mutuo pronta (RLS ligado)');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
