/**
 * Ponto pelo celular com GPS (24/10/2026 — o dono viu batidas que parecem
 * ajustadas à mão e quer prova de onde a pessoa estava).
 *
 *  - filial.ponto_lat / ponto_lng / ponto_raio_m: ponto da casa no mapa e o
 *    raio (default 150 m). Sem lat/lng = casa não aceita ponto pelo celular.
 *  - funcionario.ponto_celular_token: link pessoal /op/ponto/<token>.
 *  - ponto_batida.geo_*: onde o GPS disse que a pessoa estava + distância.
 *  - ponto_celular_tentativa: toda tentativa (aceita ou recusada).
 *
 * Aditiva e idempotente. Tabela nova termina com ENABLE ROW LEVEL SECURITY.
 *
 * Uso: pnpm --filter @concilia/db migrate:ponto-celular
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE filial ADD COLUMN IF NOT EXISTS ponto_lat numeric(10,7)`);
  await sql.unsafe(`ALTER TABLE filial ADD COLUMN IF NOT EXISTS ponto_lng numeric(10,7)`);
  await sql.unsafe(`ALTER TABLE filial ADD COLUMN IF NOT EXISTS ponto_raio_m integer NOT NULL DEFAULT 150`);

  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS ponto_celular_token varchar(64)`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS funcionario_ponto_celular_token_unique ON funcionario (ponto_celular_token)`);

  await sql.unsafe(`ALTER TABLE ponto_batida ADD COLUMN IF NOT EXISTS geo_lat numeric(10,7)`);
  await sql.unsafe(`ALTER TABLE ponto_batida ADD COLUMN IF NOT EXISTS geo_lng numeric(10,7)`);
  await sql.unsafe(`ALTER TABLE ponto_batida ADD COLUMN IF NOT EXISTS geo_precisao_m integer`);
  await sql.unsafe(`ALTER TABLE ponto_batida ADD COLUMN IF NOT EXISTS geo_distancia_m integer`);
  await sql.unsafe(`ALTER TABLE ponto_batida ADD COLUMN IF NOT EXISTS face_dist integer`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ponto_celular_tentativa (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      funcionario_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      filial_id uuid REFERENCES filial(id) ON DELETE CASCADE,
      quando timestamptz NOT NULL DEFAULT now(),
      dia_operacional date NOT NULL,
      tipo varchar(10),
      resultado varchar(20) NOT NULL,
      motivo text,
      lat numeric(10,7),
      lng numeric(10,7),
      precisao_m integer,
      distancia_m integer,
      face_dist integer,
      batida_id uuid REFERENCES ponto_batida(id) ON DELETE SET NULL,
      user_agent varchar(300)
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ponto_celular_tent_dia ON ponto_celular_tentativa (filial_id, dia_operacional)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ponto_celular_tent_pessoa ON ponto_celular_tentativa (funcionario_id, quando)`);
  await sql.unsafe(`ALTER TABLE ponto_celular_tentativa ENABLE ROW LEVEL SECURITY`);

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM filial WHERE ponto_lat IS NOT NULL`;
  console.log(`[ok] ponto pelo celular pronto (${n} casa(s) com local marcado)`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
