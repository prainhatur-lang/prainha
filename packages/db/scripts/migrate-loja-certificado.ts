// Certificado válido das lojas (22/10/2026): um *.loja.prainhabar.com do
// Let's Encrypt emitido pela nuvem e baixado pelo vendas-local de cada casa,
// + o endereço local (IP) que cada loja informa. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS loja_certificado (
      id text PRIMARY KEY,
      dominio text NOT NULL,
      cert_pem text,
      key_pem text,
      acme_conta_key text,
      emitido_em timestamptz,
      expira_em timestamptz,
      ultima_tentativa timestamptz,
      ultimo_erro text,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(`ALTER TABLE loja_certificado ENABLE ROW LEVEL SECURITY`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS loja_endereco_local (
      filial_id uuid PRIMARY KEY REFERENCES filial(id) ON DELETE CASCADE,
      nome text NOT NULL,
      ip text,
      ip_publicado text,
      publicado_em timestamptz,
      visto_em timestamptz,
      ultimo_erro text
    )`);
  await sql.unsafe(`ALTER TABLE loja_endereco_local ENABLE ROW LEVEL SECURITY`);
  console.log('ok: loja_certificado + loja_endereco_local');
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
