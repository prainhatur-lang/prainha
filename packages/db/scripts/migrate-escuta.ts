// Clima organizacional (eNPS) + ouvidoria anônima: cria ouvidoria_mensagem
// + clima_resposta, e os tokens/config públicos em filial.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:escuta

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`ALTER TABLE filial ADD COLUMN IF NOT EXISTS ouvidoria_token text`);
  await sql.unsafe(`ALTER TABLE filial ADD COLUMN IF NOT EXISTS clima_token text`);
  await sql.unsafe(`ALTER TABLE filial ADD COLUMN IF NOT EXISTS clima_dias_janela integer NOT NULL DEFAULT 7`);
  await sql.unsafe(`ALTER TABLE filial ADD COLUMN IF NOT EXISTS clima_aberto_ate date`);
  await sql.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'filial_ouvidoria_token_unique') THEN
        ALTER TABLE filial ADD CONSTRAINT filial_ouvidoria_token_unique UNIQUE (ouvidoria_token);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'filial_clima_token_unique') THEN
        ALTER TABLE filial ADD CONSTRAINT filial_clima_token_unique UNIQUE (clima_token);
      END IF;
    END $$;
  `);
  console.log('[ok] filial.ouvidoria_token/clima_token/clima_dias_janela/clima_aberto_ate prontas');

  await sql.unsafe(`UPDATE filial SET ouvidoria_token = gen_random_uuid()::text WHERE ouvidoria_token IS NULL`);
  await sql.unsafe(`UPDATE filial SET clima_token = gen_random_uuid()::text WHERE clima_token IS NULL`);
  console.log('[ok] tokens gerados pra filiais que ainda nao tinham');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ouvidoria_mensagem (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      categoria varchar(20) NOT NULL,
      mensagem text NOT NULL,
      recebida_em date NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'nova',
      observacao_interna text,
      lida_em date,
      lida_por uuid,
      resolvida_em date,
      resolvida_por uuid
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ouvidoria_filial_status ON ouvidoria_mensagem (filial_id, status)`);
  await sql.unsafe(`ALTER TABLE ouvidoria_mensagem ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] ouvidoria_mensagem pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS clima_resposta (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      competencia varchar(7) NOT NULL,
      nota integer NOT NULL,
      comentario text,
      criado_em date NOT NULL
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_clima_filial_competencia ON clima_resposta (filial_id, competencia)`);
  await sql.unsafe(`ALTER TABLE clima_resposta ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] clima_resposta pronta');

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
