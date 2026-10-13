// nota_compra_item.sem_vinculo_auto: o usuário tirou o vínculo do item na mão.
// A entrada passou a preencher sozinha o último vínculo conhecido ao abrir
// (pedido do dono em 13/10/2026); sem esta marca, o item desvinculado voltaria
// a ser vinculado na abertura seguinte.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:nota-item-sem-vinculo-auto

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(
    `ALTER TABLE nota_compra_item ADD COLUMN IF NOT EXISTS sem_vinculo_auto boolean NOT NULL DEFAULT false`,
  );
  console.log('ok: nota_compra_item.sem_vinculo_auto');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
