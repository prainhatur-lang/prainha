// Migration: fila de reimpressão de DANFE (painel enfileira, loja imprime).
// Rodar: pnpm --filter @concilia/db migrate:nfce-reimpressao

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('nfce_reimpressao... ');
  await sql`
    CREATE TABLE IF NOT EXISTS nfce_reimpressao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nfce_id uuid NOT NULL REFERENCES nfce_emitida(id) ON DELETE CASCADE,
      status varchar(12) NOT NULL DEFAULT 'PENDENTE',
      solicitado_por varchar(60),
      criado_em timestamptz NOT NULL DEFAULT now(),
      impresso_em timestamptz
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS nfce_reimp_pend_idx ON nfce_reimpressao (filial_id, status, criado_em)`;
  await sql`ALTER TABLE nfce_reimpressao ENABLE ROW LEVEL SECURITY`;
  console.log('OK');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
