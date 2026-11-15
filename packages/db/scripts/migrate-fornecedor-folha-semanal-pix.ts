// Folha semanal liberada por Pix na CHAVE do cadastro: só pra quem o dono
// autorizou, pessoa por pessoa (dono 15/11/2026: "só antonio" — Antonio da Mar
// no Pix da esposa; os outros com chave no cadastro seguem pro caixa/lotérica).
//  - fornecedor.folha_semanal_pix_em: quando o dono autorizou. NULL = não entra.
// Idempotente. Só ADD COLUMN IF NOT EXISTS — nenhuma tabela nova (RLS não muda).
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS folha_semanal_pix_em timestamptz`);
  console.log('[ok] fornecedor.folha_semanal_pix_em');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
