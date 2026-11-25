// preco_horario ganha VIGÊNCIA (data_inicio / data_fim): promoção de data
// marcada — Black Friday 26 e 27/11/2026 (dono 25/11/2026): chopp a R$ 6 no
// happy hour só nesses dias. Sem as datas a regra repetia toda semana e alguém
// tinha que lembrar de desligar. null = sem data (as regras antigas seguem iguais).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:preco-horario-vigencia

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE preco_horario ADD COLUMN IF NOT EXISTS data_inicio date`);
  await sql.unsafe(`ALTER TABLE preco_horario ADD COLUMN IF NOT EXISTS data_fim date`);
  console.log('[ok] preco_horario.data_inicio / data_fim');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
