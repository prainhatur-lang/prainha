// avaliacao.pedido_codigo: número da CONTA (pedido do PDV) que estava na mesa
// quando a avaliação do QR foi feita. Só o número da mesa não bastava: em
// 12/10/2026 a reclamação da isca de robalo entrou pelo QR da mesa 19 e a conta
// da 19 não tinha isca. Coluna nula pras avaliações antigas. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:avaliacao-pedido
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

  await run('avaliacao.pedido_codigo', () => sql`
    ALTER TABLE avaliacao ADD COLUMN IF NOT EXISTS pedido_codigo integer
  `);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
