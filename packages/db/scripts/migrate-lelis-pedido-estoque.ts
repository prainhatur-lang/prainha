// Lelis (06/11/2026): o pedido sem nota também dá ENTRADA no estoque da casa.
// - revenda_produto_casa: vínculo produto da Lelis → produto da casa (escolhido
//   uma vez na tela, depois fica salvo);
// - revenda_pedido_item ganha o produto da casa e o movimento de entrada.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:lelis-pedido-estoque

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS revenda_produto_casa (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      revenda_produto_id uuid NOT NULL REFERENCES revenda_produto(id) ON DELETE CASCADE,
      casa_filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_por text,
      CONSTRAINT uq_revenda_produto_casa UNIQUE (revenda_produto_id, casa_filial_id)
    );
    ALTER TABLE revenda_produto_casa ENABLE ROW LEVEL SECURITY;

    ALTER TABLE revenda_pedido_item ADD COLUMN IF NOT EXISTS produto_casa_id uuid REFERENCES produto(id) ON DELETE SET NULL;
    ALTER TABLE revenda_pedido_item ADD COLUMN IF NOT EXISTS movimento_casa_id uuid;
  `);
  console.log('ok: revenda_produto_casa + revenda_pedido_item.produto_casa_id/movimento_casa_id');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
