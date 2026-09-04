// Adiciona organizacao.codigo — código curto que o app da maquininha digita pra
// descobrir as filiais e os túneis (GET /api/app/filiais?empresa=). Idempotente.
// Define 'prainha' pra organização existente (Prainha Turismo).
// Uso: pnpm --filter @concilia/db migrate:organizacao-codigo
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql`ALTER TABLE organizacao ADD COLUMN IF NOT EXISTS codigo varchar(30)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS organizacao_codigo_unique ON organizacao (codigo)`;
  const r = await sql`UPDATE organizacao SET codigo = 'prainha' WHERE codigo IS NULL AND nome ILIKE 'Prainha%' RETURNING nome, codigo`;
  console.log('OK: organizacao.codigo pronta;', r.length ? `definido: ${r.map((x) => `${x.nome}=${x.codigo}`).join(', ')}` : 'nenhuma alteração (já tinha código)');
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
