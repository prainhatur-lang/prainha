// Conta a pagar que só se paga depois que a mercadoria chegar, ou com
// autorização (dono 26/11/2026, pedido 17351 da Kompack: "a diferença só pode
// ser paga depois que chegar a mercadoria ou que já for autorizado").
// Idempotente. Rodar: pnpm --filter @concilia/db migrate:conta-so-apos-chegar
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
  await run('conta_pagar.so_apos_chegar', () => sql`ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS so_apos_chegar boolean NOT NULL DEFAULT false`);
  await run('conta_pagar.liberada_em', () => sql`ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS liberada_em timestamptz`);
  await run('conta_pagar.liberada_por', () => sql`ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS liberada_por uuid`);
  await run('conta_pagar.liberada_motivo', () => sql`ALTER TABLE conta_pagar ADD COLUMN IF NOT EXISTS liberada_motivo text`);
  // A diferença do pedido 17351 (2ª parte, R$ 1.495,00) foi lançada antes da
  // trava existir: entra travada, se ainda estiver em aberto e sem autorização.
  await run('trava a 2ª parte do pedido 17351', () => sql`
    UPDATE conta_pagar SET so_apos_chegar = true
     WHERE id = '8f6f7377-b6fc-4435-b730-06c3ddcb8686'
       AND data_pagamento IS NULL AND liberada_em IS NULL`);
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
