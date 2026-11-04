// Vale-presente: contato de quem GANHOU (04/11/2026). Pago, o vale vai direto
// pro WhatsApp do presenteado (modelo `vale_presente` na Meta); o e-mail fica
// pro botão "Enviar por e-mail" da página do vale.
// Uso: pnpm --filter @concilia/db migrate:vale-presente-presenteado

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql`ALTER TABLE vale_presente ADD COLUMN IF NOT EXISTS presenteado_telefone varchar(30)`;
  await sql`ALTER TABLE vale_presente ADD COLUMN IF NOT EXISTS presenteado_email varchar(200)`;
  await sql`ALTER TABLE vale_presente ADD COLUMN IF NOT EXISTS presenteado_avisado_em timestamptz`;
  await sql`ALTER TABLE vale_presente ADD COLUMN IF NOT EXISTS presenteado_aviso text`;
  await sql`ALTER TABLE vale_presente ENABLE ROW LEVEL SECURITY`;
  const [r] = await sql`SELECT count(*)::int AS n FROM vale_presente`;
  console.log('ok — vale_presente.presenteado_*; linhas:', r?.n);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
