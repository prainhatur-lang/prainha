// RH: rescisão de quem é empregado da E.B. Serviços (30/10/2026). A casa não
// paga o funcionário: repassa pra E.B. (funcionario_documento.conta_pagar_id =
// conta "Repasse E.B." na casa) e a E.B. paga a pessoa
// (conta_pagar_empregador_id = conta na filial da E.B.).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:funcionario-documento-empregador

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    ALTER TABLE funcionario_documento
      ADD COLUMN IF NOT EXISTS conta_pagar_empregador_id uuid REFERENCES conta_pagar(id) ON DELETE SET NULL
  `);
  console.log('ok: funcionario_documento.conta_pagar_empregador_id');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
