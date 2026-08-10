// Índice no FK pedido_item.pedido_id — o join pedido × pedido_item (relatório
// de insumos, consumo por período) varria a tabela inteira (420k+ linhas) sem
// ele. CONCURRENTLY pra não travar o sync do agente enquanto cria.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  console.log('[1] Criando idx_pedido_item_pedido_id (CONCURRENTLY, pode demorar)...');
  await sql.unsafe(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedido_item_pedido_id ON pedido_item (pedido_id)',
  );
  console.log('OK.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
