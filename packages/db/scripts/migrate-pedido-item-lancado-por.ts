// QUEM LANCOU o item: nome que a loja guarda em item_autor passa a subir pro
// espelho do pedido (dono, 20/11/2026: "quem lancou os 5 a mais?").
// A loja manda pelo /api/loja/marcas (campo lancado_por).
//
// Uso: pnpm --filter @concilia/db migrate:pedido-item-lancado-por

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  process.stdout.write('  pedido_item.lancado_por... ');
  await sql`ALTER TABLE pedido_item ADD COLUMN IF NOT EXISTS lancado_por varchar(80)`;
  console.log('OK');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
