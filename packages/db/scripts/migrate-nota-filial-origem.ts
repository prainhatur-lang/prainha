// nota_compra.filial_origem_id: a casa onde a SEFAZ (DF-e) entregou a nota,
// quando ela é passada pra outra casa ("Lançar direto na casa", compras do
// Mercado Livre que caem na E.B. Serviços). Serve pra a importação do DF-e não
// trazer a mesma chave de volta pra casa de origem. Dono 22/11/2026.
//
// Uso: pnpm --filter @concilia/db migrate:nota-filial-origem

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS filial_origem_id uuid REFERENCES filial(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS movida_em timestamptz`;
  await sql`CREATE INDEX IF NOT EXISTS nota_compra_origem_chave_idx ON nota_compra (filial_origem_id, chave) WHERE filial_origem_id IS NOT NULL`;
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
