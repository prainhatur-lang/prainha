// Escala mensal dia a dia (rh_escala_dia) + funcionario.sexo (regra de domingo
// da CCT). Ver schema/rh-escala.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:escala-mensal

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS sexo varchar(1)`);
  console.log('[ok] funcionario.sexo');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS rh_escala_dia (
      funcionario_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      dia date NOT NULL,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      folga boolean NOT NULL,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_por uuid,
      CONSTRAINT uq_rh_escala_dia UNIQUE (funcionario_id, dia)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_rh_escala_dia_filial ON rh_escala_dia (filial_id, dia)`);
  await sql.unsafe(`ALTER TABLE rh_escala_dia ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] rh_escala_dia');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
