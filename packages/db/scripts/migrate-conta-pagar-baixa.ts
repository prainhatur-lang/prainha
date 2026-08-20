// Cria conta_pagar_baixa: histórico de pagamentos (inclusive parciais) de
// uma conta a pagar lançada na nuvem (origem MANUAL/NFE/FOLHA).
//
// Idempotente: CREATE TABLE/INDEX IF NOT EXISTS.
// Uso: pnpm --filter @concilia/db migrate:conta-pagar-baixa

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS conta_pagar_baixa (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      conta_pagar_id uuid NOT NULL REFERENCES conta_pagar(id) ON DELETE CASCADE,
      data date NOT NULL,
      valor numeric(14,2) NOT NULL,
      observacao text,
      criado_por uuid,
      criado_em timestamp with time zone NOT NULL DEFAULT now()
    )
  `;
  console.log('tabela conta_pagar_baixa OK');

  await sql`CREATE INDEX IF NOT EXISTS idx_cp_baixa_conta ON conta_pagar_baixa (conta_pagar_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cp_baixa_filial_data ON conta_pagar_baixa (filial_id, data)`;
  console.log('indices OK');

  // Sem isso a anon key do Supabase lê/escreve via PostgREST (já aconteceu 2x).
  await sql`ALTER TABLE conta_pagar_baixa ENABLE ROW LEVEL SECURITY`;
  console.log('RLS OK');

  await sql.end();
  console.log('Migration concluida.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
