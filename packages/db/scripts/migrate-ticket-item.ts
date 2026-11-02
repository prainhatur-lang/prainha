// ticket_item: o que a MAQUININHA mostra no 🎟 Ticket (venda direta), por casa.
// Pedido do dono (02/11/2026): "no cadastro do produto, informar o que vai pro
// ticket, porque não vai ser todos os itens". Cada linha liga um tamanho
// (código do PDV) ao ticket. Casa SEM nenhuma linha = a maquininha mostra tudo,
// como sempre foi.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:ticket-item

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ticket_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      codigo integer NOT NULL,
      atualizado_por text,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      UNIQUE (filial_id, codigo)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ticket_item_filial ON ticket_item (filial_id)`);
  await sql.unsafe(`ALTER TABLE ticket_item ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] ticket_item pronta');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
