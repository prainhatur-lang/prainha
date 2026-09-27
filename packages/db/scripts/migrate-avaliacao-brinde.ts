// AVALIE E GANHE UM DRINK (QR da mesa, vendas-local): a avaliação feita no
// celular do cliente sobe pra cá com o CPF, o mês e o drink que ele ganhou.
// A trava "um por CPF por mês" vale na loja (tabela avaliacao_brinde local);
// o índice único aqui só garante que a cópia não duplica no reenvio.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:avaliacao-brinde

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  process.stdout.write('  ALTER avaliacao ADD cpf/mes_ref/brinde/mesa... ');
  await sql`ALTER TABLE avaliacao ADD COLUMN IF NOT EXISTS cpf varchar(11)`;
  await sql`ALTER TABLE avaliacao ADD COLUMN IF NOT EXISTS mes_ref varchar(7)`;
  await sql`ALTER TABLE avaliacao ADD COLUMN IF NOT EXISTS brinde text`;
  await sql`ALTER TABLE avaliacao ADD COLUMN IF NOT EXISTS mesa integer`;
  console.log('OK');
  process.stdout.write('  UNIQUE (filial_id, cpf, mes_ref)... ');
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS avaliacao_filial_cpf_mes_uq
    ON avaliacao (filial_id, cpf, mes_ref) WHERE cpf IS NOT NULL`;
  console.log('OK');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
