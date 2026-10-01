// Produto que NAO cobra a taxa de servico (os 10%) — couvert, recreacao,
// ingresso. O Consumer tinha essa opcao no cadastro; aqui ela e uma coluna do
// produto e desce pra loja pelo /api/loja/catalogo-nuvem.
//
// Uso: pnpm --filter @concilia/db migrate:produto-sem-servico

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  process.stdout.write('  produto.sem_taxa_servico... ');
  await sql`ALTER TABLE produto ADD COLUMN IF NOT EXISTS sem_taxa_servico boolean NOT NULL DEFAULT false`;
  console.log('OK');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
