// Painel de energia/automação Tuya: tabela tuya_dispositivo (mapeamento
// dispositivo Tuya -> filial/tipo/nome) + permissões tuya.*.
// Idempotente. Uso: pnpm --filter @concilia/db migrate:tuya

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
  console.log('[1] Tabela tuya_dispositivo');
  await run('tuya_dispositivo', () =>
    sql`
      CREATE TABLE IF NOT EXISTS tuya_dispositivo (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        nome varchar(120) NOT NULL,
        tipo varchar(20) NOT NULL DEFAULT 'outro',
        tuya_device_id varchar(64) NOT NULL,
        codigo_switch varchar(40) NOT NULL DEFAULT 'switch_1',
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_tuya_dispositivo_filial_device UNIQUE (filial_id, tuya_device_id)
      )
    `,
  );
  await run('idx tuya_dispositivo filial', () =>
    sql`CREATE INDEX IF NOT EXISTS tuya_dispositivo_filial_idx ON tuya_dispositivo (filial_id, ativo)`,
  );

  console.log('[2] RLS (deny-all pro PostgREST; app acessa via role postgres)');
  await run('RLS tuya_dispositivo', () => sql.unsafe(`ALTER TABLE tuya_dispositivo ENABLE ROW LEVEL SECURITY`));

  console.log('[3] Permissoes');
  const perms = [
    ['tuya.read', 'read', 'Ver painel de energia (consumo e estado dos dispositivos)'],
    ['tuya.control', 'control', 'Ligar/desligar luzes, bombas e motores pelo painel de energia'],
    ['tuya.configurar', 'configurar', 'Cadastrar/editar dispositivos Tuya por filial'],
  ] as const;
  for (const [codigo, acao, descricao] of perms) {
    await run(`permissao ${codigo}`, () =>
      sql`
        INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
        VALUES (${codigo}, 'tuya', ${acao}, ${descricao}, 'filial')
        ON CONFLICT (codigo) DO NOTHING
      `,
    );
  }
  await run('vincular a Admin/Gerente', () =>
    sql`
      INSERT INTO grupo_permissao (grupo_id, permissao_id)
      SELECT g.id, p.id
      FROM grupo_usuario g, permissao p
      WHERE g.sistema = true AND g.nome IN ('Admin', 'Gerente')
        AND p.modulo = 'tuya'
      ON CONFLICT DO NOTHING
    `,
  );

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
