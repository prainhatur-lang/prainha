// Vale transporte: coluna vt_quinzena_item.dias_ponto_anterior — quantos dias
// do ponto da quinzena anterior entraram no acerto quando esta foi lançada.
// Com o VT gerado no último dia da quinzena (03/11/2026), o ponto desse dia
// ainda não fechou; na quinzena seguinte a diferença entra como correção.
// NULL = lançada antes disso (sem correção).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:vt-dias-ponto-anterior

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE vt_quinzena_item ADD COLUMN IF NOT EXISTS dias_ponto_anterior integer`);
  console.log('ok: vt_quinzena_item.dias_ponto_anterior');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
