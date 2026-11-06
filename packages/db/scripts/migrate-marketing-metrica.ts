// Números de engajamento dos posts do Instagram de cada casa (marketing_metrica),
// gravados pelo cron /api/cron/marketing-metricas — a chave só existe no
// servidor, então é ele que lê a Meta e guarda aqui pra análise.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:marketing-metrica

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS marketing_metrica (
      filial_id uuid NOT NULL,
      ig_post_id varchar(40) NOT NULL,
      legenda text,
      tipo varchar(20),
      produto varchar(20),
      link text,
      publicado_em timestamptz,
      curtidas integer,
      comentarios integer,
      alcance integer,
      views integer,
      salvos integer,
      compartilhamentos integer,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (filial_id, ig_post_id)
    )
  `);
  await sql.unsafe(`ALTER TABLE marketing_metrica ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] marketing_metrica pronta');
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
