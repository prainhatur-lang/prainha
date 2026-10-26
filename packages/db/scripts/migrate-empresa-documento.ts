// Documentos da empresa por casa (26/10/2026): tabela empresa_documento
// (alvarás, certidões, inscrições, com validade). Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS empresa_documento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      tipo varchar(40) NOT NULL,
      titulo text,
      numero varchar(80),
      orgao text,
      cnpj varchar(14),
      emissao date,
      validade date,
      sem_vencimento boolean NOT NULL DEFAULT false,
      observacao text,
      arquivo_path text NOT NULL,
      arquivo_nome varchar(200),
      dados jsonb,
      usuario_id uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      substituido_por uuid,
      substituido_em timestamptz,
      cancelado_em timestamptz,
      cancelado_por uuid,
      cancelado_motivo text
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_empresa_documento_filial ON empresa_documento (filial_id, validade)`);
  await sql.unsafe(`ALTER TABLE empresa_documento ENABLE ROW LEVEL SECURITY`);
  console.log('empresa_documento ok');
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
