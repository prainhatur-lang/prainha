// admissao_convite: link de admissão pelo WhatsApp (CPF → SPC → a pessoa
// completa, sobe documentos, aceita o contrato e assina com selfie).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:admissao-convite

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS admissao_convite (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      funcionario_id uuid REFERENCES funcionario(id) ON DELETE SET NULL,
      cpf varchar(11) NOT NULL,
      nome varchar(200) NOT NULL,
      telefone varchar(20) NOT NULL,
      termos jsonb NOT NULL,
      dados_spc jsonb,
      pessoais jsonb,
      documentos jsonb,
      token varchar(64) NOT NULL UNIQUE,
      status varchar(20) NOT NULL DEFAULT 'enviado',
      expira_em timestamptz NOT NULL,
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      aberto_em timestamptz,
      assinado_em timestamptz,
      assinado_ip varchar(80),
      assinado_aparelho text,
      selfie_path text,
      rubrica_path text,
      face_distancia varchar(12),
      texto_aceite text,
      hash_contrato varchar(64),
      documento_contrato_id uuid,
      assinatura_id uuid,
      cancelado_em timestamptz,
      cancelado_por uuid
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_admissao_convite_filial ON admissao_convite (filial_id, criado_em)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_admissao_convite_cpf ON admissao_convite (cpf)`);
  await sql.unsafe(`ALTER TABLE admissao_convite ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] admissao_convite pronta (RLS ligado)');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
