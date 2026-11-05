// Troca de folga entre colegas pelo tablet do ponto (rh_troca_folga).
// Ver schema/rh-escala.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:troca-folga

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS rh_troca_folga (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      id_local integer NOT NULL,
      solicitante_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      colega_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      dia_trabalha date NOT NULL,
      dia_devolve date NOT NULL,
      status varchar(20) NOT NULL,
      criada_em timestamptz NOT NULL DEFAULT now(),
      respondida_em timestamptz,
      escala_aplicada_em timestamptz,
      CONSTRAINT uq_rh_troca_folga_local UNIQUE (filial_id, id_local)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_rh_troca_folga_filial ON rh_troca_folga (filial_id, dia_trabalha)`);
  await sql.unsafe(`ALTER TABLE rh_troca_folga ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] rh_troca_folga');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
