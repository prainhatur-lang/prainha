// Rescisão paga → aviso pro contador dar baixa no eSocial (dono 25/11/2026:
// "quando for feito o pagamento da rescisão do funcionário, enviar uma
// mensagem para o contador informando para dar baixa no e-social").
// Uma linha por termo de rescisão (funcionario_documento): marca quando o
// aviso foi (uma vez só), pra quem e o último erro.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:rescisao-aviso-esocial

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS rescisao_aviso_esocial (
      documento_id uuid PRIMARY KEY REFERENCES funcionario_documento(id) ON DELETE CASCADE,
      filial_id uuid,
      conta_pagar_id uuid,
      enviado_em timestamptz,
      para text,
      erro text,
      tentativas integer NOT NULL DEFAULT 0,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE rescisao_aviso_esocial ENABLE ROW LEVEL SECURITY;
  `);
  console.log('rescisao_aviso_esocial OK (RLS ligado)');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
