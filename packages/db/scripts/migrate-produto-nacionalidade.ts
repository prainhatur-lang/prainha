// Nacionalidade no cadastro do produto (pedido do dono 15/11/2026: "no caso de
// vinho português, italiano etc").
//  - produto.nacionalidade: texto livre (país de origem). NULL = não informado.
// Idempotente. Só ADD COLUMN IF NOT EXISTS — nenhuma tabela nova (RLS não muda).
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE produto ADD COLUMN IF NOT EXISTS nacionalidade varchar(60)`);
  console.log('[ok] produto.nacionalidade');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
