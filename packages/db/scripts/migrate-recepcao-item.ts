// recepcao_item: tamanhos (código do PDV) que SAEM NA RECEPÇÃO quando vendidos
// no 🎟 Ticket da maquininha ou no totem (02/11/2026). Pedido do dono: "nós
// criamos um novo setor, que é a recepção... quando sair a venda, aquele item
// vai ter que ir para a recepção" — só as bebidas marcadas; comida segue na
// cozinha e o garçom leva. Venda na mesa não muda.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:recepcao-item

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS recepcao_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo integer NOT NULL,
      atualizado_por text,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      UNIQUE (filial_id, codigo)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_recepcao_item_filial ON recepcao_item (filial_id)`);
  await sql.unsafe(`ALTER TABLE recepcao_item ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] recepcao_item pronta');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
