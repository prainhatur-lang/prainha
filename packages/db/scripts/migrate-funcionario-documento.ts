// Documentos de entrada e saída do funcionário (25/10/2026): tabela
// funcionario_documento. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS funcionario_documento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      funcionario_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      momento varchar(20) NOT NULL,
      tipo varchar(40) NOT NULL,
      descricao text,
      arquivo_path text NOT NULL,
      arquivo_nome varchar(200),
      usuario_id uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      cancelado_em timestamptz,
      cancelado_por uuid,
      cancelado_motivo text
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_funcionario_documento_pessoa ON funcionario_documento (funcionario_id, momento)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_funcionario_documento_filial ON funcionario_documento (filial_id, criado_em)`);
  await sql.unsafe(`ALTER TABLE funcionario_documento ENABLE ROW LEVEL SECURITY`);
  console.log('funcionario_documento ok');
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
