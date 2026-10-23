// Relatório diário (23/10/2026): a Meta aceitar (wa_message_id) não prova que
// chegou. O webhook passa a gravar enviada/entregue/lida/erro aqui, pra tela
// mostrar se o relatório chegou mesmo (caso Lula, dias 18 e 19 da Mar).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:relatorio-status-entrega

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE relatorio_diario_envio ADD COLUMN IF NOT EXISTS status_entrega varchar(12)`);
  await sql.unsafe(`ALTER TABLE relatorio_diario_envio ADD COLUMN IF NOT EXISTS status_em timestamptz`);
  console.log('[ok] relatorio_diario_envio.status_entrega / status_em');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
