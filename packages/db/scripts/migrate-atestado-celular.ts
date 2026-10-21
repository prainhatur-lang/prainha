// Atestado pelo celular (21/10/2026): abona/origem/lido no atestado + tabela
// atestado_leitura (foto lida pela IA esperando confirmação). Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario_atestado ADD COLUMN IF NOT EXISTS abona boolean NOT NULL DEFAULT true`);
  await sql.unsafe(`ALTER TABLE funcionario_atestado ADD COLUMN IF NOT EXISTS origem varchar(20) NOT NULL DEFAULT 'manual'`);
  await sql.unsafe(`ALTER TABLE funcionario_atestado ADD COLUMN IF NOT EXISTS lido jsonb`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS atestado_leitura (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      link_e integer NOT NULL,
      usuario_id uuid,
      arquivo_path text NOT NULL,
      arquivo_nome varchar(200),
      lido jsonb,
      erro text,
      candidatos jsonb,
      status varchar(20) NOT NULL DEFAULT 'pendente',
      atestado_id uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      resolvido_em timestamptz
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_atestado_leitura_filial ON atestado_leitura (filial_id, criado_em)`);
  await sql.unsafe(`ALTER TABLE atestado_leitura ENABLE ROW LEVEL SECURITY`);
  console.log('atestado celular ok');
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
