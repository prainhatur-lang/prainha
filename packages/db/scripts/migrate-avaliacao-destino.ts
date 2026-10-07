// filial.avaliacao_destino: pra onde a nota alta leva o cliente ('google',
// 'tripadvisor' ou 'escolher'). Default 'google' = o comportamento de sempre
// (abre o Google sozinho), então nenhuma filial muda ao rodar isto. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:avaliacao-destino
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

  await run('filial.avaliacao_destino', () => sql`
    ALTER TABLE filial ADD COLUMN IF NOT EXISTS avaliacao_destino text NOT NULL DEFAULT 'google'
  `);

  const linhas = await sql<Array<{ nome: string; avaliacao_destino: string }>>`
    SELECT nome, avaliacao_destino FROM filial ORDER BY nome
  `;
  for (const l of linhas) console.log(`  ${l.nome}: ${l.avaliacao_destino}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
