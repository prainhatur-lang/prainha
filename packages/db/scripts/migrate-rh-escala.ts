// Histórico do ponto antigo (Stelanto) + jornada (escala) + banco de horas.
// Ver packages/db/src/schema/rh-escala.ts.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:rh-escala

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS stelanto_colaborador (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      stelanto_user_id varchar(40) NOT NULL,
      funcionario_id uuid REFERENCES funcionario(id) ON DELETE SET NULL,
      filial_id uuid REFERENCES filial(id) ON DELETE SET NULL,
      nome varchar(200) NOT NULL,
      cpf varchar(11),
      email varchar(200),
      telefone varchar(30),
      data_nascimento date,
      data_admissao date,
      data_desligamento date,
      status varchar(20) NOT NULL,
      equipe varchar(80),
      unidade varchar(80),
      jornada varchar(120),
      dias_trabalhados integer NOT NULL DEFAULT 0,
      primeiro_dia date,
      ultimo_dia date,
      importado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_stelanto_colaborador_user ON stelanto_colaborador (stelanto_user_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_stelanto_colaborador_funcionario ON stelanto_colaborador (funcionario_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_stelanto_colaborador_filial ON stelanto_colaborador (filial_id)`);
  await sql.unsafe(`ALTER TABLE stelanto_colaborador ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] stelanto_colaborador pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS stelanto_dia (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      colaborador_id uuid NOT NULL REFERENCES stelanto_colaborador(id) ON DELETE CASCADE,
      dia date NOT NULL,
      status varchar(30),
      jornada varchar(120),
      previsto_seg integer NOT NULL DEFAULT 0,
      trabalhado_seg integer NOT NULL DEFAULT 0,
      intervalo_seg integer NOT NULL DEFAULT 0,
      falta_seg integer NOT NULL DEFAULT 0,
      extra_seg integer NOT NULL DEFAULT 0,
      noturno_seg integer NOT NULL DEFAULT 0,
      saldo_dia_seg integer NOT NULL DEFAULT 0,
      saldo_acumulado_seg integer NOT NULL DEFAULT 0,
      batidas jsonb,
      pedido jsonb,
      outros jsonb
    )`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_stelanto_dia ON stelanto_dia (colaborador_id, dia)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_stelanto_dia_dia ON stelanto_dia (dia)`);
  await sql.unsafe(`ALTER TABLE stelanto_dia ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] stelanto_dia pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS rh_jornada (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nome varchar(120) NOT NULL,
      tipo varchar(20) NOT NULL DEFAULT 'fixa',
      min_seg integer NOT NULL DEFAULT 0,
      min_ter integer NOT NULL DEFAULT 0,
      min_qua integer NOT NULL DEFAULT 0,
      min_qui integer NOT NULL DEFAULT 0,
      min_sex integer NOT NULL DEFAULT 0,
      min_sab integer NOT NULL DEFAULT 0,
      min_dom integer NOT NULL DEFAULT 0,
      origem varchar(20) NOT NULL DEFAULT 'manual',
      ativo boolean NOT NULL DEFAULT true,
      criado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_rh_jornada_nome ON rh_jornada (nome)`);
  await sql.unsafe(`ALTER TABLE rh_jornada ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] rh_jornada pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS funcionario_jornada (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      funcionario_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      jornada_id uuid NOT NULL REFERENCES rh_jornada(id) ON DELETE RESTRICT,
      vigente_desde date NOT NULL,
      usuario_id uuid,
      criado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_funcionario_jornada ON funcionario_jornada (funcionario_id, vigente_desde)`);
  await sql.unsafe(`ALTER TABLE funcionario_jornada ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] funcionario_jornada pronta');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS banco_horas_lancamento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      funcionario_id uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      dia date NOT NULL,
      minutos integer NOT NULL,
      tipo varchar(20) NOT NULL,
      origem varchar(20) NOT NULL DEFAULT 'manual',
      descricao text,
      usuario_id uuid,
      criado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_banco_horas_pessoa ON banco_horas_lancamento (funcionario_id, dia)`);
  // Reimporte do saldo do Stelanto nunca duplica: um saldo inicial por pessoa.
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_horas_saldo_inicial ON banco_horas_lancamento (funcionario_id) WHERE tipo = 'saldo_inicial'`);
  await sql.unsafe(`ALTER TABLE banco_horas_lancamento ENABLE ROW LEVEL SECURITY`);
  console.log('[ok] banco_horas_lancamento pronta');

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
