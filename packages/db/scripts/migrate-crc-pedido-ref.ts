// CONTA A RECEBER DE CANAL: aceitar pedido que NÃO veio do Consumer.
//
// O lançamento nasceu amarrado ao PEDIDOS.CODIGO do Consumer (inteiro). Com a
// integração própria do iFood o pedido não passa mais pelo Consumer — ele tem
// só o id do iFood (uuid). Sem isto, no dia da virada o lançamento financeiro
// simplesmente deixaria de nascer, e o repasse do iFood ficaria sem contra-
// partida no sistema.
//
// pedido_ref = id do pedido no canal (uuid do iFood). Unicidade por
// (filial, pedido_ref) num índice PARCIAL, pra não brigar com as linhas
// antigas que têm pedido_ref nulo.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:crc-pedido-ref

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE conta_receber_canal ADD COLUMN IF NOT EXISTS pedido_ref text`);
  // o pedido do iFood direto não tem código do Consumer
  await sql.unsafe(`ALTER TABLE conta_receber_canal ALTER COLUMN pedido_codigo_externo DROP NOT NULL`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_crc_filial_ref
    ON conta_receber_canal (filial_id, pedido_ref) WHERE pedido_ref IS NOT NULL`);
  const [c] = await sql`SELECT count(*)::int n FROM conta_receber_canal`;
  console.log('conta_receber_canal ok — linhas existentes:', c.n);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
