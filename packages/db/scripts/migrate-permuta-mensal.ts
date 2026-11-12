// Permuta (11/11/2026): crédito liberado mês a mês (contrato de R$ 2.500/mês
// por 12 meses não entra inteiro no PDV). Colunas novas no contrato (null =
// tudo de uma vez, como sempre) + tabela permuta_liberacao (uma linha por casa
// e por mês). Ver packages/db/src/schema/permuta.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:permuta-mensal

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE permuta_contrato ADD COLUMN IF NOT EXISTS liberacao_meses integer;
    ALTER TABLE permuta_contrato ADD COLUMN IF NOT EXISTS liberacao_inicio date;
  `);
  console.log('[ok] permuta_contrato.liberacao_meses/liberacao_inicio');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS permuta_liberacao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      credito_id uuid NOT NULL REFERENCES permuta_credito(id) ON DELETE CASCADE,
      contrato_id uuid NOT NULL REFERENCES permuta_contrato(id) ON DELETE CASCADE,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      numero integer NOT NULL,
      data date NOT NULL,
      valor numeric(12,2) NOT NULL,
      status varchar(12) NOT NULL DEFAULT 'agendada',
      fiado_lancamento_id uuid,
      lancado_em timestamptz,
      criado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_permuta_liberacao_credito ON permuta_liberacao (credito_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_permuta_liberacao_status ON permuta_liberacao (status, data)`);
  await sql.unsafe(`ALTER TABLE permuta_liberacao ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] permuta_liberacao (+ RLS)');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
