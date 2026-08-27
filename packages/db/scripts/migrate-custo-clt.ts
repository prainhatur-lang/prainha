// Custo de CLT (indicador no fechamento, nao gera conta_pagar): adiciona
// regime_salarial + salario_base em funcionario, e pct_encargos_clt em
// folha_config.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:custo-clt

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS regime_salarial varchar(20)`);
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS salario_base numeric(10,2)`);
  console.log('[ok] funcionario.regime_salarial + salario_base prontas');

  await sql.unsafe(
    `ALTER TABLE folha_config ADD COLUMN IF NOT EXISTS pct_encargos_clt numeric(5,2) NOT NULL DEFAULT 20.00`,
  );
  console.log('[ok] folha_config.pct_encargos_clt pronta');

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
