// Extrato bancário de empresa que paga pessoal e não é uma das casas (E.B.
// Serviços). Ver packages/db/src/schema/extrato-empresa.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:extrato-empresa

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS extrato_empresa (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa varchar(20) NOT NULL,
      data_movimento date NOT NULL,
      tipo char(1) NOT NULL,
      valor numeric(14,2) NOT NULL,
      codigo_historico varchar(30),
      titulo text,
      descricao text,
      id_transacao varchar(50) NOT NULL,
      importado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_extrato_empresa UNIQUE (empresa, data_movimento, tipo, valor, id_transacao)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_extrato_empresa_data ON extrato_empresa (empresa, data_movimento)`);
  await sql.unsafe(`ALTER TABLE extrato_empresa ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] extrato_empresa pronta (RLS ligado)');
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
