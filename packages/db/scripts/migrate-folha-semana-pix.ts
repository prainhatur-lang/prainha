// Folha semanal liberada pra pagar por Pix na conta Inter de cada funcionário
// (dono, 14/11/2026 — folha do Bar 02–08/11: "Lançar todos eles no pagamento
// por Pix, que já existe").
//  - folha_semana.pix_liberado_em / pix_liberado_por: marca a folha cujas
//    contas (de quem tem conta Inter) entram em Pedidos a pagar por Pix.
// Idempotente. Só ADD COLUMN IF NOT EXISTS — nenhuma tabela nova (RLS não muda).
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE folha_semana ADD COLUMN IF NOT EXISTS pix_liberado_em timestamptz`);
  await sql.unsafe(`ALTER TABLE folha_semana ADD COLUMN IF NOT EXISTS pix_liberado_por text`);
  console.log('[ok] folha_semana.pix_liberado_em / pix_liberado_por');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
