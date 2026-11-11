// Nota de serviço (NFS-e) avulsa pra empresa de fora — tabela nfse_avulsa.
// Ver schema/nfse-avulsa.ts. Idempotente.
// Uso: pnpm --filter @concilia/db migrate:nfse-avulsa

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS nfse_avulsa (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      tomador_cnpj varchar(14) NOT NULL,
      tomador_nome varchar(300) NOT NULL,
      tomador_email varchar(80),
      tomador_codigo_municipio varchar(7) NOT NULL,
      tomador_cidade varchar(120),
      tomador_cep varchar(8) NOT NULL,
      tomador_logradouro varchar(255) NOT NULL,
      tomador_numero varchar(60),
      tomador_bairro varchar(60) NOT NULL,
      codigo_tributacao varchar(6) NOT NULL,
      descricao text NOT NULL,
      municipio_prestacao varchar(7) NOT NULL,
      data_competencia date NOT NULL,
      valor_servico numeric(14,2) NOT NULL,
      aliquota_iss numeric(5,2),
      iss_retido boolean NOT NULL DEFAULT false,
      valor_iss numeric(14,2) NOT NULL DEFAULT 0,
      valor_liquido numeric(14,2) NOT NULL,
      status varchar(12) NOT NULL DEFAULT 'RASCUNHO',
      nfse_numero_dps integer,
      nfse_numero varchar(20),
      nfse_chave varchar(60),
      nfse_emitida_em timestamptz,
      nfse_xml text,
      nfse_erro text,
      criado_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_nfse_avulsa_filial ON nfse_avulsa (filial_id, criado_em)`);
  await sql.unsafe(`ALTER TABLE nfse_avulsa ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] nfse_avulsa pronta (RLS ligado)');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
