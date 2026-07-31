// Adiciona filial.tripadvisor_review_url e seeda os links de avaliacao publica
// (Google + TripAdvisor) das filiais ativas. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:avaliacao-links

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

// Match por nome (ILIKE) -> { google, tripadvisor }
const SEED: Array<{ matchNome: string; google: string; tripadvisor: string }> = [
  {
    matchNome: '%Prainha Bar%',
    google: 'https://share.google/JfGECOeKfe5jxtl4a',
    tripadvisor: 'https://www.tripadvisor.pt/UserReviewEdit-d16804020?m=68676',
  },
  {
    matchNome: '%Tabuar%',
    google: 'https://share.google/zmHpBAFH2gjsIWoHe',
    tripadvisor: 'https://www.tripadvisor.com.br/UserReviewEdit-d33110570?m=68676',
  },
];

async function main() {
  process.stdout.write('  ALTER filial ADD tripadvisor_review_url... ');
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS tripadvisor_review_url text`;
  console.log('OK');

  console.log('  Seed dos links por filial:');
  for (const s of SEED) {
    const r = await sql<Array<{ nome: string }>>`
      UPDATE filial
      SET google_review_url = ${s.google},
          tripadvisor_review_url = ${s.tripadvisor}
      WHERE nome ILIKE ${s.matchNome}
      RETURNING nome
    `;
    if (r.length === 0) {
      console.log(`    ⚠️  nenhuma filial casou com ${s.matchNome}`);
    } else {
      for (const f of r) console.log(`    ✓ ${f.nome} — Google + TripAdvisor`);
    }
  }

  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
