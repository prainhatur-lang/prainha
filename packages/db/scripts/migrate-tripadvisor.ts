// TripAdvisor de cada casa lido da API oficial: tripadvisor_resumo (uma foto
// por casa por dia: nota, total, distribuição) e tripadvisor_avaliacao (as
// avaliações que a API entregou). Quem grava é o cron /api/cron/tripadvisor.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:tripadvisor

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS tripadvisor_resumo (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      dia date NOT NULL,
      location_id integer NOT NULL,
      nota numeric(3,1),
      total integer NOT NULL DEFAULT 0,
      distribuicao jsonb,
      subnotas jsonb,
      pagina_url text,
      lido_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS tripadvisor_resumo_filial_dia_uq ON tripadvisor_resumo (filial_id, dia)`);
  await sql.unsafe(`ALTER TABLE tripadvisor_resumo ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] tripadvisor_resumo pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS tripadvisor_avaliacao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      review_id bigint NOT NULL,
      nota integer NOT NULL,
      titulo text,
      texto text,
      idioma varchar(12),
      usuario varchar(120),
      publicado_em timestamptz,
      viagem varchar(10),
      url text,
      respondida boolean NOT NULL DEFAULT false,
      resposta_texto text,
      visto_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS tripadvisor_avaliacao_filial_review_uq ON tripadvisor_avaliacao (filial_id, review_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS tripadvisor_avaliacao_filial_pub_idx ON tripadvisor_avaliacao (filial_id, publicado_em)`);
  await sql.unsafe(`ALTER TABLE tripadvisor_avaliacao ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] tripadvisor_avaliacao pronta');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
