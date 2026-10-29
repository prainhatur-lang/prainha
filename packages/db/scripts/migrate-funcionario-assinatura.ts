// Assinatura eletrônica de documento pelo funcionário (29/10/2026): tabela
// funcionario_assinatura. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS funcionario_assinatura (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      funcionario_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      documento_id uuid NOT NULL REFERENCES funcionario_documento(id) ON DELETE CASCADE,
      token varchar(64) NOT NULL UNIQUE,
      status varchar(20) NOT NULL DEFAULT 'pendente',
      hash_documento varchar(64) NOT NULL,
      enviado_por uuid,
      enviado_em timestamptz NOT NULL DEFAULT now(),
      expira_em timestamptz NOT NULL,
      aberto_em timestamptz,
      assinado_em timestamptz,
      assinado_ip varchar(80),
      assinado_aparelho text,
      cpf_informado varchar(11),
      hash_no_aceite varchar(64),
      selfie_path text,
      face_distancia varchar(12),
      texto_aceite text,
      cancelado_em timestamptz,
      cancelado_por uuid
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_funcionario_assinatura_doc ON funcionario_assinatura (documento_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_funcionario_assinatura_pessoa ON funcionario_assinatura (funcionario_id, enviado_em)`);
  await sql.unsafe(`ALTER TABLE funcionario_assinatura ENABLE ROW LEVEL SECURITY`);
  console.log('funcionario_assinatura ok');
}

main().then(() => sql.end()).catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
