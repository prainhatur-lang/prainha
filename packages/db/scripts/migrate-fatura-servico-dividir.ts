// Fatura da E.B. dividida em duas NFS-e (19/10/2026): a parte que bate com o
// PGDAS já declarado fica na competência da folha, e a diferença vira outra
// fatura (complemento_de = a principal) com a NFS-e em outra competência.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fatura-servico-dividir

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE fatura_servico ADD COLUMN IF NOT EXISTS complemento_de uuid REFERENCES fatura_servico(id) ON DELETE SET NULL;
    ALTER TABLE fatura_servico ADD COLUMN IF NOT EXISTS competencia_nfse varchar(7);
    CREATE INDEX IF NOT EXISTS idx_fatura_servico_complemento ON fatura_servico(complemento_de);
  `);
  console.log('ok: fatura_servico.complemento_de + competencia_nfse');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
