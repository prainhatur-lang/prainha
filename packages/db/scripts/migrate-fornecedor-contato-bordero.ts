// Borderô pra lotérica vai junto com o comprovante do Pix (dono, 13/11/2026).
//  - fornecedor.contato_nome: nome da pessoa que atende no WhatsApp do
//    intermediário (ex.: Júnior, da lotérica) — entra na saudação.
//  - pix_comprovante_envio.com_bordero: o PDF enviado levou a relação do borderô.
// Idempotente. Só ADD COLUMN IF NOT EXISTS — nenhuma tabela nova (RLS não muda).
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE fornecedor ADD COLUMN IF NOT EXISTS contato_nome varchar(120)`);
  console.log('[ok] fornecedor.contato_nome');
  await sql.unsafe(
    `ALTER TABLE pix_comprovante_envio ADD COLUMN IF NOT EXISTS com_bordero boolean NOT NULL DEFAULT false`,
  );
  console.log('[ok] pix_comprovante_envio.com_bordero');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
