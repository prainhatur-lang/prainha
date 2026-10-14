// Lista de compra da semana (sugestão salva): lista_compra + lista_compra_item.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:lista-compra

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS lista_compra (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      data varchar(10) NOT NULL,
      titulo text,
      origem varchar(20) NOT NULL DEFAULT 'LISTA_COZINHA',
      status varchar(12) NOT NULL DEFAULT 'ABERTA',
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_lista_compra_filial ON lista_compra (filial_id, data)`);
  await sql.unsafe(`ALTER TABLE lista_compra ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] lista_compra pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS lista_compra_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lista_id uuid NOT NULL REFERENCES lista_compra(id) ON DELETE CASCADE,
      produto_id uuid REFERENCES produto(id) ON DELETE SET NULL,
      texto_original text,
      quantidade numeric(14,4),
      unidade varchar(10),
      observacao text,
      grupo varchar(20),
      cotacao_id uuid REFERENCES cotacao(id) ON DELETE SET NULL,
      ordem integer,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_lista_compra_item_lista ON lista_compra_item (lista_id)`);
  await sql.unsafe(`ALTER TABLE lista_compra_item ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] lista_compra_item pronta');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
