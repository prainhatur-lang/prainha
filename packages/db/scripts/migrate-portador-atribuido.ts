// Portadores: grava quem (usuário logado) atribuiu a sangria "sem portador" a
// um portador, e quando. Quem lançou e quem excluiu já ficavam em
// criado_por / excluido_por.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:portador-atribuido

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE portador_movimento ADD COLUMN IF NOT EXISTS atribuido_por uuid REFERENCES usuario(id)`);
  await sql.unsafe(`ALTER TABLE portador_movimento ADD COLUMN IF NOT EXISTS atribuido_em timestamptz`);
  console.log('[ok] portador_movimento.atribuido_por / atribuido_em');
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
