// fiado_lancamento.lancamento_banco_id — baixa de fiado amarrada ao Pix
// recebido no extrato (lancamento_banco). Um Pix pode quitar mais de uma
// baixa, mas a soma nunca passa do valor dele (checado na API).
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fiado-pix-vinculo
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE fiado_lancamento ADD COLUMN IF NOT EXISTS lancamento_banco_id uuid REFERENCES lancamento_banco(id) ON DELETE SET NULL`;
  await sql`CREATE INDEX IF NOT EXISTS fl_lancamento_banco ON fiado_lancamento (lancamento_banco_id) WHERE lancamento_banco_id IS NOT NULL`;
  console.log('OK: fiado_lancamento.lancamento_banco_id pronta');
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
