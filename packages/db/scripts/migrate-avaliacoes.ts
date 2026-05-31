// Cria infra de avaliacoes de clientes (reputacao). Idempotente.
// Uso: pnpm --filter @concilia/db migrate:avaliacoes
//
// 1) Campos novos na filial (avaliacao_token, google_review_url, nota_corte_google)
// 2) Tabela avaliacao + indices
// 3) Backfill: gera um avaliacao_token pra cada filial que ainda nao tem

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

function novoToken(): string {
  // 32 bytes -> 64 hex chars. Longo o bastante pra ser inadivinhavel e
  // passa no guard `token.length >= 20` da pagina publica.
  return randomBytes(32).toString('hex');
}

async function main() {
  process.stdout.write('  ALTER filial ADD avaliacao_token / google_review_url / nota_corte_google... ');
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS avaliacao_token text`;
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS google_review_url text`;
  await sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS nota_corte_google integer NOT NULL DEFAULT 4`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS filial_avaliacao_token_unique
      ON filial (avaliacao_token) WHERE avaliacao_token IS NOT NULL
  `;
  console.log('OK');

  process.stdout.write('  CREATE TABLE avaliacao + indices... ');
  await sql`
    CREATE TABLE IF NOT EXISTS avaliacao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nota integer NOT NULL,
      comentario text,
      nome varchar(200),
      whatsapp varchar(30),
      origem varchar(100),
      foi_pra_google boolean NOT NULL DEFAULT false,
      status varchar(20) NOT NULL DEFAULT 'novo',
      observacao_interna text,
      resolvido_por uuid,
      criado_em timestamp with time zone NOT NULL DEFAULT now(),
      atualizado_em timestamp with time zone NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS avaliacao_filial_status_idx ON avaliacao (filial_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS avaliacao_filial_criado_idx ON avaliacao (filial_id, criado_em)`;
  console.log('OK');

  process.stdout.write('  Backfill avaliacao_token nas filiais sem token... ');
  const semToken = await sql<Array<{ id: string; nome: string }>>`
    SELECT id, nome FROM filial WHERE avaliacao_token IS NULL
  `;
  for (const f of semToken) {
    await sql`UPDATE filial SET avaliacao_token = ${novoToken()} WHERE id = ${f.id}`;
  }
  console.log(`OK — ${semToken.length} filial(is) com token novo`);

  // Mostra os links prontos pra colar no QR
  const filiais = await sql<Array<{ nome: string; avaliacao_token: string }>>`
    SELECT nome, avaliacao_token FROM filial WHERE avaliacao_token IS NOT NULL ORDER BY nome
  `;
  console.log('\n  Links de avaliacao (base — adicione ?o=mesa-X pra atribuir):');
  for (const f of filiais) {
    console.log(`    ${f.nome}: /avaliar/${f.avaliacao_token}`);
  }

  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
