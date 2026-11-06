// Token do Inter compartilhado entre os servidores da Vercel (06/11/2026: Pix
// da Márcia falhou com 429 — cada servidor pedia o próprio token e o Inter
// limita quantos se pede por minuto). Token vale 1 h e vai cifrado.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL ausente');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS inter_token (
      chave varchar(200) PRIMARY KEY,
      token text NOT NULL,
      expira_em timestamptz NOT NULL,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(`ALTER TABLE inter_token ENABLE ROW LEVEL SECURITY`);
  console.log('ok inter_token');
}
main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
