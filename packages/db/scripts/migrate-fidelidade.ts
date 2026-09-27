// Cartão fidelidade (Apple/Google Wallet): tabelas fidelidade_* + permissões.
//   · fidelidade.read / fidelidade.create → quem já tem reserva.update
//     (Admin, Gerente, Recepção, Vendas): ver cartões e convidar cliente.
//   · fidelidade.configurar → quem já tem usuario.update (admin): mexer nos
//     níveis/percentuais, bloquear cartão, dar nível garantido.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:fidelidade

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  try {
    const r = await fn();
    console.log('OK');
    return r;
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function main() {
  await run('fidelidade_programa', () => sql`
    CREATE TABLE IF NOT EXISTS fidelidade_programa (
      organizacao_id uuid PRIMARY KEY REFERENCES organizacao(id) ON DELETE CASCADE,
      ativo boolean NOT NULL DEFAULT true,
      config jsonb NOT NULL,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )`);
  await run('fidelidade_cartao', () => sql`
    CREATE TABLE IF NOT EXISTS fidelidade_cartao (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organizacao_id uuid NOT NULL REFERENCES organizacao(id) ON DELETE CASCADE,
      nome varchar(120) NOT NULL,
      telefone varchar(20) NOT NULL,
      cpf varchar(11),
      numero varchar(12) NOT NULL,
      token varchar(40) NOT NULL,
      codigo varchar(4) NOT NULL,
      codigo_gerado_em timestamptz NOT NULL DEFAULT now(),
      nivel_minimo varchar(20),
      nivel_minimo_ate date,
      status varchar(12) NOT NULL DEFAULT 'ativo',
      origem varchar(20) NOT NULL DEFAULT 'convite',
      filial_origem_id uuid REFERENCES filial(id) ON DELETE SET NULL,
      origem_detalhe text,
      apple_auth_token varchar(64) NOT NULL,
      pass_atualizado_em timestamptz NOT NULL DEFAULT now(),
      google_salvo_em timestamptz,
      aberto_em timestamptz,
      convidado_em timestamptz,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_fidelidade_cartao_telefone UNIQUE (organizacao_id, telefone),
      CONSTRAINT uq_fidelidade_cartao_token UNIQUE (token),
      CONSTRAINT uq_fidelidade_cartao_numero UNIQUE (numero)
    )`);
  await run('uq código ativo', () => sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fidelidade_cartao_codigo_ativo
      ON fidelidade_cartao (organizacao_id, codigo) WHERE status = 'ativo'`);
  await run('fidelidade_uso', () => sql`
    CREATE TABLE IF NOT EXISTS fidelidade_uso (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cartao_id uuid NOT NULL REFERENCES fidelidade_cartao(id) ON DELETE CASCADE,
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      mesa integer,
      codigo varchar(4) NOT NULL,
      nivel varchar(20) NOT NULL,
      pct_nivel numeric(5,2) NOT NULL,
      pct_bonus numeric(5,2) NOT NULL DEFAULT 0,
      valor_base numeric(12,2) NOT NULL,
      valor_desconto numeric(12,2) NOT NULL,
      status varchar(12) NOT NULL DEFAULT 'reservado',
      txid varchar(64),
      reservado_em timestamptz NOT NULL DEFAULT now(),
      expira_em timestamptz NOT NULL,
      confirmado_em timestamptz
    )`);
  await run('idx uso cartão', () => sql`CREATE INDEX IF NOT EXISTS idx_fidelidade_uso_cartao ON fidelidade_uso (cartao_id, reservado_em)`);
  await run('idx uso filial', () => sql`CREATE INDEX IF NOT EXISTS idx_fidelidade_uso_filial ON fidelidade_uso (filial_id, reservado_em)`);
  await run('fidelidade_visita', () => sql`
    CREATE TABLE IF NOT EXISTS fidelidade_visita (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cartao_id uuid NOT NULL REFERENCES fidelidade_cartao(id) ON DELETE CASCADE,
      filial_id uuid REFERENCES filial(id) ON DELETE SET NULL,
      data date NOT NULL,
      origem varchar(12) NOT NULL DEFAULT 'pix',
      uso_id uuid REFERENCES fidelidade_uso(id) ON DELETE SET NULL,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_fidelidade_visita_dia UNIQUE (cartao_id, data)
    )`);
  await run('fidelidade_apple_registro', () => sql`
    CREATE TABLE IF NOT EXISTS fidelidade_apple_registro (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cartao_id uuid NOT NULL REFERENCES fidelidade_cartao(id) ON DELETE CASCADE,
      device_id varchar(128) NOT NULL,
      push_token varchar(200) NOT NULL,
      criado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_fidelidade_apple_dev_cartao UNIQUE (device_id, cartao_id)
    )`);
  for (const t of ['fidelidade_programa', 'fidelidade_cartao', 'fidelidade_uso', 'fidelidade_visita', 'fidelidade_apple_registro']) {
    await run(`RLS ${t}`, () => sql.unsafe(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`));
  }

  console.log('[permissões]');
  const perms: Array<[string, string, string, string]> = [
    ['fidelidade.read', 'read', 'Ver cartões fidelidade', 'reserva.update'],
    ['fidelidade.create', 'create', 'Convidar cliente pro cartão fidelidade', 'reserva.update'],
    ['fidelidade.configurar', 'configurar', 'Configurar níveis do cartão fidelidade e bloquear cartão', 'usuario.update'],
  ];
  for (const [codigo, acao, descricao, base] of perms) {
    await run(codigo, () => sql`
      INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
      VALUES (${codigo}, 'fidelidade', ${acao}, ${descricao}, 'organizacao')
      ON CONFLICT (codigo) DO NOTHING`);
    const r = await sql`
      INSERT INTO grupo_permissao (grupo_id, permissao_id)
      SELECT gp.grupo_id, nova.id
      FROM grupo_permissao gp
      JOIN permissao b ON b.id = gp.permissao_id AND b.codigo = ${base}
      CROSS JOIN permissao nova
      WHERE nova.codigo = ${codigo}
      ON CONFLICT DO NOTHING
      RETURNING grupo_id`;
    console.log(`    ${r.length} grupos ganharam ${codigo} (base ${base})`);
  }

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
