// Resposta automática no Google (18/10/2026, pedido do dono: "suba a resposta
// sem precisar de intervenção humana"). filial.google_resposta_auto =
// 'todas' (default) | 'nota_alta' (só 4 e 5) | 'desligado'. E em
// avaliacao_resposta_ia o id da avaliação do Google respondida + quando saiu,
// pra o cron não responder duas vezes a mesma.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:google-resposta-auto
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

async function main() {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_DIRECT/DATABASE_URL ausente');
  const sql = postgres(url, { prepare: false, ssl: 'require' });
  const run = async (name: string, fn: () => Promise<unknown>) => {
    process.stdout.write(`${name}... `);
    await fn();
    console.log('ok');
  };

  await run('filial.google_resposta_auto', () => sql`
    ALTER TABLE filial ADD COLUMN IF NOT EXISTS google_resposta_auto varchar(20) NOT NULL DEFAULT 'todas'
  `);
  await run('avaliacao_resposta_ia.review_id', () => sql`
    ALTER TABLE avaliacao_resposta_ia ADD COLUMN IF NOT EXISTS review_id varchar(200)
  `);
  await run('avaliacao_resposta_ia.publicada_em', () => sql`
    ALTER TABLE avaliacao_resposta_ia ADD COLUMN IF NOT EXISTS publicada_em timestamptz
  `);
  await run('idx review', () => sql`
    CREATE INDEX IF NOT EXISTS idx_avaliacao_resposta_ia_review ON avaliacao_resposta_ia (filial_id, review_id) WHERE review_id IS NOT NULL
  `);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
