// Vale transporte quinzenal: vt_pessoa (valor do dia por pessoa),
// vt_quinzena + vt_quinzena_item (o que foi pago em cada quinzena).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:vale-transporte

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS vt_pessoa (
      funcionario_id uuid PRIMARY KEY REFERENCES funcionario(id) ON DELETE CASCADE,
      ativo boolean NOT NULL DEFAULT true,
      valor_dia numeric(10,2) NOT NULL,
      dias_semana integer,
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_por uuid
    )
  `);
  await sql.unsafe(`ALTER TABLE vt_pessoa ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] vt_pessoa');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS vt_quinzena (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      data_inicio date NOT NULL,
      data_fim date NOT NULL,
      paga_em timestamptz NOT NULL DEFAULT now(),
      paga_por uuid,
      CONSTRAINT uq_vt_quinzena_filial_inicio UNIQUE (filial_id, data_inicio)
    )
  `);
  await sql.unsafe(`ALTER TABLE vt_quinzena ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] vt_quinzena');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS vt_quinzena_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      quinzena_id uuid NOT NULL REFERENCES vt_quinzena(id) ON DELETE CASCADE,
      funcionario_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      valor_dia numeric(10,2) NOT NULL,
      dias_previstos integer NOT NULL,
      valor_previsto numeric(10,2) NOT NULL,
      acerto_anterior numeric(10,2) NOT NULL DEFAULT 0,
      valor_pago numeric(10,2) NOT NULL,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_vt_quinzena_item UNIQUE (quinzena_id, funcionario_id)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_vt_quinzena_item_pessoa ON vt_quinzena_item (funcionario_id)`);
  await sql.unsafe(`ALTER TABLE vt_quinzena_item ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] vt_quinzena_item');

  // Desconto de 6% no salário (18/10/2026): gravado quando a quinzena seguinte é paga.
  await sql.unsafe(`ALTER TABLE vt_quinzena_item ADD COLUMN IF NOT EXISTS desconto_base numeric(10,2)`);
  await sql.unsafe(`ALTER TABLE vt_quinzena_item ADD COLUMN IF NOT EXISTS desconto_valor numeric(10,2)`);
  console.log('[ok] vt_quinzena_item.desconto_*');

  // Forma do VT (18/10/2026): 'folha' (desconta 6%) ou 'dinheiro' (ajuda de custo).
  await sql.unsafe(`ALTER TABLE vt_pessoa ADD COLUMN IF NOT EXISTS forma varchar(10) NOT NULL DEFAULT 'folha'`);
  await sql.unsafe(`ALTER TABLE vt_quinzena_item ADD COLUMN IF NOT EXISTS forma varchar(10) NOT NULL DEFAULT 'folha'`);
  console.log('[ok] forma');

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
