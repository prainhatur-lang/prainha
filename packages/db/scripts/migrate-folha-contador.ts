// Folha do contador (Extrato Mensal): registro em carteira no cadastro do
// funcionário + a folha do mês por pessoa + o resumo de cada PDF.
// Ver packages/db/src/schema/folha-contador.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:folha-contador

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function main() {
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS empresa_registro varchar(120)`);
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS cnpj_registro varchar(14)`);
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS cargo_registro varchar(80)`);
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS cbo varchar(10)`);
  await sql.unsafe(`ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS matricula_folha varchar(20)`);
  console.log('[ok] funcionario: empresa_registro, cnpj_registro, cargo_registro, cbo, matricula_folha');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS folha_contador (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE RESTRICT,
      funcionario_id uuid REFERENCES funcionario(id) ON DELETE SET NULL,
      competencia varchar(7) NOT NULL,
      empresa varchar(120) NOT NULL,
      cnpj varchar(14) NOT NULL,
      departamento varchar(80),
      matricula varchar(20) NOT NULL,
      nome varchar(200) NOT NULL,
      cpf varchar(11),
      situacao varchar(60),
      vinculo varchar(60),
      cargo varchar(80),
      cbo varchar(10),
      data_admissao date,
      horas_mes numeric(7,2),
      salario numeric(10,2),
      proventos numeric(12,2) NOT NULL DEFAULT 0,
      descontos numeric(12,2) NOT NULL DEFAULT 0,
      liquido numeric(12,2) NOT NULL DEFAULT 0,
      base_inss numeric(12,2),
      base_fgts numeric(12,2),
      valor_fgts numeric(12,2),
      base_irrf numeric(12,2),
      demitido_em date,
      motivo_demissao varchar(200),
      rubricas jsonb NOT NULL DEFAULT '[]'::jsonb,
      arquivo varchar(200),
      importado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_folha_contador UNIQUE (cnpj, competencia, matricula)
    )
  `);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_folha_contador_filial_comp ON folha_contador (filial_id, competencia)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_folha_contador_funcionario ON folha_contador (funcionario_id)`);
  await sql.unsafe(`ALTER TABLE folha_contador ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] folha_contador pronta (RLS ligado)');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS folha_contador_resumo (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE RESTRICT,
      competencia varchar(7) NOT NULL,
      empresa varchar(120) NOT NULL,
      cnpj varchar(14) NOT NULL,
      departamento varchar(80) NOT NULL DEFAULT '',
      empregados integer NOT NULL DEFAULT 0,
      trabalhando integer NOT NULL DEFAULT 0,
      demitidos integer NOT NULL DEFAULT 0,
      proventos numeric(12,2) NOT NULL DEFAULT 0,
      descontos numeric(12,2) NOT NULL DEFAULT 0,
      liquido numeric(12,2) NOT NULL DEFAULT 0,
      inss_segurados numeric(12,2) NOT NULL DEFAULT 0,
      inss_empresa numeric(12,2) NOT NULL DEFAULT 0,
      inss_rat numeric(12,2) NOT NULL DEFAULT 0,
      inss_terceiros numeric(12,2) NOT NULL DEFAULT 0,
      fgts numeric(12,2) NOT NULL DEFAULT 0,
      fgts_rescisorio numeric(12,2) NOT NULL DEFAULT 0,
      irrf numeric(12,2) NOT NULL DEFAULT 0,
      arquivo varchar(200),
      importado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_folha_contador_resumo UNIQUE (cnpj, competencia, departamento)
    )
  `);
  await sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_folha_contador_resumo_filial_comp ON folha_contador_resumo (filial_id, competencia)`,
  );
  await sql.unsafe(`ALTER TABLE folha_contador_resumo ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] folha_contador_resumo pronta (RLS ligado)');

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
