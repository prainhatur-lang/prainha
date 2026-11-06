// Lelis (06/11/2026): a casa CONFERE o pedido sem nota e só aí dá entrada no
// estoque dela (dono: "cada casa confere e dá entrada").
// - revenda_pedido: quando/quem conferiu + observação;
// - revenda_pedido_item.quantidade_recebida: o que chegou (falta volta pra Lelis).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:lelis-pedido-conferencia

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE revenda_pedido ADD COLUMN IF NOT EXISTS recebido_em timestamptz;
    ALTER TABLE revenda_pedido ADD COLUMN IF NOT EXISTS recebido_por text;
    ALTER TABLE revenda_pedido ADD COLUMN IF NOT EXISTS observacao_recebimento text;
    ALTER TABLE revenda_pedido_item ADD COLUMN IF NOT EXISTS quantidade_recebida numeric(14,4);
  `);
  console.log('ok: revenda_pedido.recebido_em/por + revenda_pedido_item.quantidade_recebida');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
