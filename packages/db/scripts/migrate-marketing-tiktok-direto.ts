// TikTok direto no /marketing → Publicar (pedido do dono 01/11/2026): guarda
// as escolhas do post (privacidade, comentários, dueto, stitch, conteúdo
// comercial). Vazio = rascunho, como sempre. Só coluna nova.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:marketing-tiktok-direto

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE marketing_post ADD COLUMN IF NOT EXISTS tiktok_direto jsonb`);
  await sql.unsafe(`ALTER TABLE marketing_post ENABLE ROW LEVEL SECURITY`);
  console.log('ok: marketing_post.tiktok_direto');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
