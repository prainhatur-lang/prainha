// fornecedor.fone_whatsapp — o número que a casa usa pra falar com o
// fornecedor, imune ao sync do Consumer.
//
// POR QUE existe, já que há fone_principal: o mapper só preserva o telefone da
// nuvem quando o Consumer manda VAZIO. Quando o Consumer tem um número (quase
// sempre o FIXO da empresa), ele sobrescreve a cada sincronização.
//
// Foi assim que o pedido nº 24 (01/09/2026) foi disparado pro fixo
// (79) 3322-1035 da Megga: o celular do Alex tinha sido gravado horas antes e
// o sync devolveu o fixo. wa.me pra telefone fixo não chega em ninguém — o
// fornecedor recebeu a cotação (mandada na mão) e nunca recebeu o pedido.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fone-whatsapp

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function run(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${label}... `);
  await fn();
  console.log('OK');
}

async function main() {
  console.log('[1] coluna fone_whatsapp');
  await run('add column', () =>
    sql`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS fone_whatsapp varchar(30)`,
  );

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
