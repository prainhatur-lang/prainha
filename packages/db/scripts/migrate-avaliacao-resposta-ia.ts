// Respostas que a IA escreveu pras avaliações (18/10/2026): guardar o texto
// NOSSO (nunca o da avaliação) pra próxima resposta não repetir abertura,
// frases e fecho. Pedido do dono: "buscar uma resposta bacana, sem repetir".
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:avaliacao-resposta-ia

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS avaliacao_resposta_ia (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      canal varchar(20) NOT NULL,
      nota integer,
      resposta text NOT NULL,
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_avaliacao_resposta_ia_filial ON avaliacao_resposta_ia (filial_id, criado_em DESC)`);
  await sql.unsafe(`ALTER TABLE avaliacao_resposta_ia ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] avaliacao_resposta_ia');
  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
