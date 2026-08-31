// Metas e premiação de equipe: cria meta_equipe + meta_equipe_rateio,
// categoria_premiacao_id em folha_config, e meta_equipe_id em folha_ajuste.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:metas

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(
    `ALTER TABLE folha_config ADD COLUMN IF NOT EXISTS categoria_premiacao_id uuid REFERENCES categoria_conta(id) ON DELETE SET NULL`,
  );
  console.log('[ok] folha_config.categoria_premiacao_id pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS meta_equipe (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      nome varchar(200) NOT NULL,
      metrica varchar(30) NOT NULL,
      valor_alvo numeric(12,2) NOT NULL,
      competencia varchar(7) NOT NULL,
      data_inicio date NOT NULL,
      data_fim date NOT NULL,
      premiacao_total numeric(10,2) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'aberta',
      valor_realizado numeric(12,2),
      bateu_meta boolean,
      regra_snapshot jsonb,
      folha_semana_vinculada_id uuid REFERENCES folha_semana(id) ON DELETE SET NULL,
      avaliada_em timestamptz,
      avaliada_por uuid,
      vinculada_em timestamptz,
      vinculada_por uuid,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_meta_equipe_filial_competencia ON meta_equipe (filial_id, competencia)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_meta_equipe_status ON meta_equipe (filial_id, status)`);
  await sql.unsafe(`ALTER TABLE meta_equipe ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] meta_equipe pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS meta_equipe_rateio (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      meta_equipe_id uuid NOT NULL REFERENCES meta_equipe(id) ON DELETE CASCADE,
      fornecedor_id uuid NOT NULL REFERENCES fornecedor(id) ON DELETE CASCADE,
      pessoa_nome varchar(200) NOT NULL,
      minutos_trabalhados integer NOT NULL,
      valor_rateado numeric(10,2) NOT NULL,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_meta_equipe_rateio_meta_pessoa UNIQUE (meta_equipe_id, fornecedor_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_meta_equipe_rateio_meta ON meta_equipe_rateio (meta_equipe_id)`);
  await sql.unsafe(`ALTER TABLE meta_equipe_rateio ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] meta_equipe_rateio pronta');

  await sql.unsafe(
    `ALTER TABLE folha_ajuste ADD COLUMN IF NOT EXISTS meta_equipe_id uuid REFERENCES meta_equipe(id) ON DELETE SET NULL`,
  );
  console.log('[ok] folha_ajuste.meta_equipe_id pronta');

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
