// E.B. Serviços no Concilia (19/10/2026): organização + filial próprias
// (empresa à parte, fora do grupo Prainha), nfse_config do emitente e
// fatura_servico (uma fatura de mão de obra por casa por competência).
//
// A filial da E.B. NÃO ganha usuario_filial — ver schema/nfse.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:eb-faturas

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const EB_CNPJ = '05486249000172';

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS nfse_config (
      filial_id uuid PRIMARY KEY REFERENCES filial(id) ON DELETE CASCADE,
      razao_social varchar(150) NOT NULL,
      cnpj varchar(14) NOT NULL,
      inscricao_municipal varchar(20),
      codigo_municipio varchar(7) NOT NULL,
      ambiente varchar(12) NOT NULL DEFAULT 'producao',
      codigo_tributacao varchar(6) NOT NULL DEFAULT '170501',
      aliquota_iss numeric(5,2),
      percentual_lucro numeric(6,2) NOT NULL DEFAULT 0,
      base varchar(20) NOT NULL DEFAULT 'proventos_fgts',
      dia_vencimento integer NOT NULL DEFAULT 10,
      serie_dps varchar(5) NOT NULL DEFAULT '1',
      proximo_numero_dps integer NOT NULL DEFAULT 1,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_por uuid
    )
  `);
  await sql.unsafe(`ALTER TABLE nfse_config ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] nfse_config');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS fatura_servico (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      tomador_filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE RESTRICT,
      competencia varchar(7) NOT NULL,
      empregados integer NOT NULL DEFAULT 0,
      horas numeric(10,2) NOT NULL DEFAULT 0,
      proventos numeric(12,2) NOT NULL DEFAULT 0,
      fgts numeric(12,2) NOT NULL DEFAULT 0,
      liquido_folha numeric(12,2) NOT NULL DEFAULT 0,
      base varchar(20) NOT NULL,
      valor_base numeric(12,2) NOT NULL,
      percentual_lucro numeric(6,2) NOT NULL,
      valor_lucro numeric(12,2) NOT NULL,
      valor_servico numeric(12,2) NOT NULL,
      aliquota_iss numeric(5,2) NOT NULL,
      valor_iss numeric(12,2) NOT NULL,
      iss_retido boolean NOT NULL DEFAULT true,
      valor_liquido numeric(12,2) NOT NULL,
      vencimento date NOT NULL,
      discriminacao text NOT NULL,
      status varchar(12) NOT NULL DEFAULT 'RASCUNHO',
      recebido_em date,
      valor_recebido numeric(12,2),
      conta_pagar_id uuid,
      conta_iss_id uuid,
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
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_fatura_servico_comp ON fatura_servico (filial_id, competencia)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_fatura_servico_tomador ON fatura_servico (tomador_filial_id, competencia)`);
  // Uma fatura viva por casa por mês (cancelada não conta).
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fatura_servico_viva
      ON fatura_servico (filial_id, tomador_filial_id, competencia)
      WHERE status <> 'CANCELADA'
  `);
  await sql.unsafe(`ALTER TABLE fatura_servico ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] fatura_servico');

  // Organização + filial da E.B.
  await sql`
    INSERT INTO organizacao (nome, cnpj_raiz, codigo)
    VALUES ('E.B. Serviços Ltda', ${EB_CNPJ.slice(0, 8)}, 'eb')
    ON CONFLICT (codigo) DO NOTHING
  `;
  const [org] = await sql<{ id: string }[]>`SELECT id FROM organizacao WHERE codigo = 'eb'`;
  let [fil] = await sql<{ id: string }[]>`SELECT id FROM filial WHERE cnpj = ${EB_CNPJ}`;
  if (!fil) {
    const token = 'agt_' + randomBytes(24).toString('base64url');
    [fil] = await sql<{ id: string }[]>`
      INSERT INTO filial (organizacao_id, nome, cnpj, agente_token)
      VALUES (${org!.id}, 'E.B. Serviços', ${EB_CNPJ}, ${token})
      RETURNING id
    `;
  }
  console.log('[ok] filial E.B.', fil!.id);

  await sql`
    INSERT INTO nfse_config (filial_id, razao_social, cnpj, inscricao_municipal, codigo_municipio)
    VALUES (${fil!.id}, 'E.B.SERVICOS LTDA', ${EB_CNPJ}, '0665995', '2800308')
    ON CONFLICT (filial_id) DO NOTHING
  `;
  console.log('[ok] nfse_config E.B.');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
