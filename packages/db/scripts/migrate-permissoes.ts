// Cria 4 tabelas do modulo Permissoes + popula catalogo + grupos sistema.
// Migra usuarios atuais (role em usuario_filial) pros grupos equivalentes.
//
// Idempotente em todas as fases:
//   - CREATE TABLE IF NOT EXISTS
//   - INSERT ON CONFLICT DO NOTHING / UPDATE
//
// Uso: pnpm --filter @concilia/db migrate:permissoes

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
import { PERMISSOES, GRUPOS_SISTEMA, ROLE_PARA_GRUPO } from '../src/catalogo-permissoes';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

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
  console.log('[1] Tabelas');
  await run('CREATE TABLE permissao', () =>
    sql`
      CREATE TABLE IF NOT EXISTS permissao (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo varchar(60) NOT NULL UNIQUE,
        modulo varchar(30) NOT NULL,
        acao varchar(30) NOT NULL,
        descricao text,
        escopo varchar(20) NOT NULL DEFAULT 'filial',
        criado_em timestamp with time zone NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx permissao modulo', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_permissao_modulo ON permissao (modulo)`,
  );

  await run('CREATE TABLE grupo_usuario', () =>
    sql`
      CREATE TABLE IF NOT EXISTS grupo_usuario (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organizacao_id uuid REFERENCES organizacao(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        descricao text,
        sistema boolean NOT NULL DEFAULT false,
        criado_em timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT uq_grupo_org_nome UNIQUE (organizacao_id, nome)
      )
    `,
  );
  await run('idx grupo organizacao', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_grupo_org ON grupo_usuario (organizacao_id)`,
  );

  await run('CREATE TABLE grupo_permissao', () =>
    sql`
      CREATE TABLE IF NOT EXISTS grupo_permissao (
        grupo_id uuid NOT NULL REFERENCES grupo_usuario(id) ON DELETE CASCADE,
        permissao_id uuid NOT NULL REFERENCES permissao(id) ON DELETE CASCADE,
        criado_em timestamp with time zone NOT NULL DEFAULT now(),
        PRIMARY KEY (grupo_id, permissao_id)
      )
    `,
  );
  await run('idx grupo_permissao permissao', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_grp_perm_perm ON grupo_permissao (permissao_id)`,
  );

  await run('CREATE TABLE usuario_grupo', () =>
    sql`
      CREATE TABLE IF NOT EXISTS usuario_grupo (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
        grupo_id uuid NOT NULL REFERENCES grupo_usuario(id) ON DELETE CASCADE,
        filial_id uuid REFERENCES filial(id) ON DELETE CASCADE,
        criado_em timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT uq_user_grupo_filial UNIQUE (usuario_id, grupo_id, filial_id)
      )
    `,
  );
  await run('idx usuario_grupo user', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_user_grupo_user ON usuario_grupo (usuario_id)`,
  );
  await run('idx usuario_grupo grupo', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_user_grupo_grupo ON usuario_grupo (grupo_id)`,
  );

  console.log(`\n[2] Catalogo de permissoes (${PERMISSOES.length} entradas)`);
  for (const p of PERMISSOES) {
    await sql`
      INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
      VALUES (${p.codigo}, ${p.modulo}, ${p.acao}, ${p.descricao}, ${p.escopo ?? 'filial'})
      ON CONFLICT (codigo) DO UPDATE SET
        modulo = EXCLUDED.modulo,
        acao = EXCLUDED.acao,
        descricao = EXCLUDED.descricao,
        escopo = EXCLUDED.escopo
    `;
  }
  console.log(`  ${PERMISSOES.length} permissoes upserted`);

  // Carrega todos codigos (com ids) pra montar links
  const todasPerm = await sql<Array<{ id: string; codigo: string }>>`
    SELECT id, codigo FROM permissao
  `;
  const idPorCodigo = new Map(todasPerm.map((p) => [p.codigo, p.id]));
  const todosCodigos = todasPerm.map((p) => p.codigo);

  console.log(`\n[3] Grupos do sistema (${GRUPOS_SISTEMA.length})`);
  for (const g of GRUPOS_SISTEMA) {
    // Cria grupo sistema (organizacao_id = NULL, sistema=true)
    const [{ id: grupoId }] = await sql<Array<{ id: string }>>`
      INSERT INTO grupo_usuario (organizacao_id, nome, descricao, sistema)
      VALUES (NULL, ${g.nome}, ${g.descricao}, true)
      ON CONFLICT (organizacao_id, nome) DO UPDATE SET descricao = EXCLUDED.descricao
      RETURNING id
    `;

    // Limpa permissoes antigas e re-aplica (mais simples que diff)
    await sql`DELETE FROM grupo_permissao WHERE grupo_id = ${grupoId}`;
    const codigos = g.permissoes(todosCodigos);
    for (const codigo of codigos) {
      const permId = idPorCodigo.get(codigo);
      if (!permId) continue;
      await sql`
        INSERT INTO grupo_permissao (grupo_id, permissao_id)
        VALUES (${grupoId}, ${permId})
        ON CONFLICT DO NOTHING
      `;
    }
    console.log(`  ${g.nome}: ${codigos.length} permissoes`);
  }

  console.log('\n[4] Migracao usuario_filial.role -> usuario_grupo');
  // Pra cada (usuario_id, role) existente, cria entrada em usuario_grupo
  // apontando pro grupo sistema correspondente, sem filial (vale pras filiais
  // que o user ja tem via usuario_filial).
  let migrados = 0;
  for (const [roleAntigo, grupoNome] of Object.entries(ROLE_PARA_GRUPO)) {
    const [grupo] = await sql<Array<{ id: string }>>`
      SELECT id FROM grupo_usuario WHERE sistema = true AND nome = ${grupoNome} LIMIT 1
    `;
    if (!grupo) continue;
    // Distinct usuarios com esse role
    const users = await sql<Array<{ usuario_id: string }>>`
      SELECT DISTINCT usuario_id FROM usuario_filial WHERE role = ${roleAntigo}
    `;
    for (const u of users) {
      await sql`
        INSERT INTO usuario_grupo (usuario_id, grupo_id, filial_id)
        VALUES (${u.usuario_id}, ${grupo.id}, NULL)
        ON CONFLICT DO NOTHING
      `;
      migrados++;
    }
    console.log(`  ${roleAntigo} -> ${grupoNome}: ${users.length} usuarios`);
  }
  console.log(`  Total migrados: ${migrados}`);

  console.log('\nMigration concluida.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
