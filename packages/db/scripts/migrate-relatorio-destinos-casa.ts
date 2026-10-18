// Relatório por casa (18/10/2026): quem recebe só algumas casas, o que vai na
// mensagem e se entra os 10% — lista em relatorio_diario_config.destinos_casa.
// NULL = ainda não salvo pela tela (vale a lista fixa do código: Lula e Lidiane).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:relatorio-destinos-casa

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE relatorio_diario_config ADD COLUMN IF NOT EXISTS destinos_casa jsonb`);
  console.log('[ok] relatorio_diario_config.destinos_casa');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
