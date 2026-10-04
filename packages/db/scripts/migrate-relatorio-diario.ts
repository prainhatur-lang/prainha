// Relatório diário das casas pelo WhatsApp: relatorio_diario_config (quem
// recebe, por organização) e relatorio_diario_envio (cada envio e cada toque).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:relatorio-diario

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS relatorio_diario_config (
      organizacao_id uuid PRIMARY KEY REFERENCES organizacao(id) ON DELETE CASCADE,
      ativo boolean NOT NULL DEFAULT true,
      telefones jsonb NOT NULL DEFAULT '[]'::jsonb,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_por uuid
    )
  `);
  await sql.unsafe(`ALTER TABLE relatorio_diario_config ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] relatorio_diario_config pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS relatorio_diario_envio (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      dia date NOT NULL,
      telefone varchar(20) NOT NULL,
      canal varchar(12) NOT NULL,
      origem varchar(12) NOT NULL DEFAULT 'cron',
      ok boolean NOT NULL,
      erro text,
      wa_message_id text,
      phone_number_id text,
      criado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS relatorio_diario_envio_dia_idx ON relatorio_diario_envio (organizacao_id, dia)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS relatorio_diario_envio_fone_idx ON relatorio_diario_envio (telefone, criado_em)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS relatorio_diario_envio_wa_idx ON relatorio_diario_envio (wa_message_id)`);
  await sql.unsafe(`ALTER TABLE relatorio_diario_envio ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] relatorio_diario_envio pronta');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
