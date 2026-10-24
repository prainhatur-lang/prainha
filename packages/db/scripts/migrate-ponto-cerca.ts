/**
 * Cerca geográfica do ponto pelo celular (24/10/2026): polígono desenhado no
 * mapa em /rh/ponto, por casa, valendo pra todos ou só pra algumas pessoas
 * (ex.: motoristas). Aditiva e idempotente; tabela nova com RLS.
 *
 * Uso: pnpm --filter @concilia/db migrate:ponto-cerca
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ponto_cerca (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nome varchar(80) NOT NULL,
      pontos jsonb NOT NULL,
      folga_m integer NOT NULL DEFAULT 20,
      funcionario_ids uuid[],
      ativa boolean NOT NULL DEFAULT true,
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ponto_cerca_filial ON ponto_cerca (filial_id)`);
  await sql.unsafe(`ALTER TABLE ponto_cerca ENABLE ROW LEVEL SECURITY`);

  await sql.unsafe(`ALTER TABLE ponto_batida ADD COLUMN IF NOT EXISTS geo_cerca_id uuid`);
  await sql.unsafe(`ALTER TABLE ponto_celular_tentativa ADD COLUMN IF NOT EXISTS cerca_id uuid`);

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM ponto_cerca`;
  console.log(`[ok] cerca do ponto pronta (${n} cerca(s))`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
