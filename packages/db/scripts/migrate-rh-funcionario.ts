// Fase 1 do RH: cadastro único de funcionário + ponto próprio.
//
// 4 tabelas: funcionario (hub, referencia fornecedor/colaborador/talento/
// usuario_operacao por FK nullable — nenhum deles muda), ponto_batida
// (append-only), ponto_batida_ajuste (auditoria de correção manual),
// ponto_dia (cache derivado).
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:rh-funcionario

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function run(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${label}... `);
  await fn();
  console.log('OK');
}

async function main() {
  console.log('[1] tabela funcionario');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS funcionario (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id             uuid NOT NULL REFERENCES filial(id) ON DELETE RESTRICT,
      cpf                   varchar(11),
      nome                  varchar(200) NOT NULL,
      data_nascimento       date,
      telefone              varchar(20),
      endereco              text,
      foto_path             text,
      cargo                 varchar(60),
      setor                 varchar(20),
      data_admissao         date,
      data_desligamento     date,
      motivo_desligamento   varchar(200),
      ativo                 boolean NOT NULL DEFAULT true,
      login_local           varchar(60),
      fornecedor_id         uuid REFERENCES fornecedor(id) ON DELETE SET NULL,
      colaborador_id        uuid REFERENCES colaborador(id) ON DELETE SET NULL,
      talento_id            uuid REFERENCES talento(id) ON DELETE SET NULL,
      usuario_operacao_id   uuid REFERENCES usuario_operacao(id) ON DELETE SET NULL,
      precisa_revisao       boolean NOT NULL DEFAULT false,
      observacao            text,
      criado_em             timestamptz NOT NULL DEFAULT now(),
      atualizado_em         timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('unique cpf', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_funcionario_cpf ON funcionario (cpf)`,
  );
  await run('unique fornecedor', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_funcionario_fornecedor ON funcionario (fornecedor_id)`,
  );
  await run('unique colaborador', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_funcionario_colaborador ON funcionario (colaborador_id)`,
  );
  await run('unique usuario_operacao', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_funcionario_usuario_operacao ON funcionario (usuario_operacao_id)`,
  );
  await run('index filial+ativo', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_funcionario_filial_ativo ON funcionario (filial_id, ativo)`,
  );
  await run('index nome', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_funcionario_nome ON funcionario (nome)`,
  );

  console.log('[2] tabela ponto_batida');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS ponto_batida (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id        uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      funcionario_id   uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      quando           timestamptz NOT NULL,
      dia_operacional  date NOT NULL,
      tipo             varchar(10) NOT NULL,
      origem           varchar(20) NOT NULL DEFAULT 'vendas_local',
      id_local          bigint,
      dispositivo      varchar(120),
      login_local      varchar(60),
      excluida_em      timestamptz,
      excluida_por     uuid,
      recebido_em      timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('unique (filial, id_local)', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_ponto_batida_filial_local ON ponto_batida (filial_id, id_local)`,
  );
  await run('index por dia', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_ponto_batida_dia ON ponto_batida (filial_id, dia_operacional)`,
  );
  await run('index por pessoa', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_ponto_batida_pessoa ON ponto_batida (funcionario_id, dia_operacional)`,
  );

  console.log('[3] tabela ponto_batida_ajuste');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS ponto_batida_ajuste (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id        uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      funcionario_id   uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      batida_id        uuid REFERENCES ponto_batida(id) ON DELETE SET NULL,
      dia              date NOT NULL,
      acao             varchar(12) NOT NULL,
      valor_antes      jsonb,
      valor_depois     jsonb,
      justificativa    text NOT NULL,
      usuario_id       uuid NOT NULL,
      criado_em        timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('index por dia', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_ponto_ajuste_dia ON ponto_batida_ajuste (filial_id, dia)`,
  );

  console.log('[4] tabela ponto_dia');
  await run('create table', () => sql`
    CREATE TABLE IF NOT EXISTS ponto_dia (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id        uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      funcionario_id   uuid NOT NULL REFERENCES funcionario(id) ON DELETE CASCADE,
      dia              date NOT NULL,
      total_min        integer NOT NULL DEFAULT 0,
      status           varchar(12) NOT NULL DEFAULT 'ok',
      pares            jsonb,
      calculado_em     timestamptz NOT NULL DEFAULT now()
    )
  `);
  await run('unique (filial, funcionario, dia)', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_ponto_dia ON ponto_dia (filial_id, funcionario_id, dia)`,
  );

  // Tabela nova SEMPRE com RLS (ENABLE, nunca FORCE): sem isso a anon key do
  // Supabase le/escreve a tabela inteira via PostgREST.
  console.log('[5] RLS');
  await run('funcionario', () => sql`ALTER TABLE funcionario ENABLE ROW LEVEL SECURITY`);
  await run('ponto_batida', () => sql`ALTER TABLE ponto_batida ENABLE ROW LEVEL SECURITY`);
  await run('ponto_batida_ajuste', () => sql`ALTER TABLE ponto_batida_ajuste ENABLE ROW LEVEL SECURITY`);
  await run('ponto_dia', () => sql`ALTER TABLE ponto_dia ENABLE ROW LEVEL SECURITY`);

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
