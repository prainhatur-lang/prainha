// "Chegou estoque e não está à venda" (11/11/2026): tabela das perguntas que o
// dono respondeu "deixar como está" — pra não perguntar de novo.
// Ver packages/db/src/schema/venda-pergunta.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:venda-pergunta

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS venda_pergunta_dispensa (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      variante_id uuid NOT NULL REFERENCES produto_variante(id) ON DELETE CASCADE,
      dispensado_por varchar(120),
      dispensado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_venda_pergunta_dispensa UNIQUE (filial_id, variante_id)
    )`);
  await sql.unsafe(`ALTER TABLE venda_pergunta_dispensa ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] venda_pergunta_dispensa (+ RLS)');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
