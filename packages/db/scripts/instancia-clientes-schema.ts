// Monta o banco da INSTÂNCIA DOS CLIENTES do SaaS (02/11/2026).
//
// Copia do banco do Prainha SÓ A ESTRUTURA (pg_dump --schema-only do schema
// public: tabelas, índices, funções, RLS) + o catálogo de permissões e os
// grupos-modelo do sistema (sem o 'Admin', que é global). NENHUM dado do
// Prainha vai junto.
//
// Uso (de packages/db):
//   CLIENTES_DATABASE_URL='postgresql://...' pnpm instancia:clientes-schema
// (ou a variável no ../../.env). Recusa rodar se o destino for o banco do
// Prainha ou se o destino já tiver tabelas (passe --so-catalogo pra só
// atualizar permissões/grupos num banco já montado).

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const ORIGEM = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const DESTINO = process.env.CLIENTES_DATABASE_URL;
const SO_CATALOGO = process.argv.includes('--so-catalogo');
const PROJETO_PRAINHA = 'creiatloobgqsvmirven';

if (!ORIGEM) throw new Error('DATABASE_URL_DIRECT (Prainha) não definida');
if (!DESTINO) throw new Error('CLIENTES_DATABASE_URL não definida');
if (DESTINO === ORIGEM || DESTINO.includes(PROJETO_PRAINHA)) {
  throw new Error('CLIENTES_DATABASE_URL aponta pro banco do Prainha. Parei.');
}

const src = postgres(ORIGEM, { prepare: false, ssl: 'require' });
const dst = postgres(DESTINO, { prepare: false, ssl: 'require' });

function rodar(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} falhou: ${r.stderr.slice(-2000)}`);
  return r.stdout;
}

async function estrutura() {
  const [{ n }] = await dst<{ n: number }[]>`select count(*)::int n from pg_tables where schemaname='public'`;
  if (n > 0) throw new Error(`O destino já tem ${n} tabelas no public. Use --so-catalogo ou um banco vazio.`);

  // Extensões que o schema usa (no Supabase ficam no schema "extensions").
  for (const ext of ['pgcrypto', 'unaccent', 'uuid-ossp']) {
    await dst.unsafe(`CREATE EXTENSION IF NOT EXISTS "${ext}" WITH SCHEMA extensions`);
  }

  console.log('  pg_dump (só estrutura)...');
  const dump = rodar('pg_dump', [
    '--schema-only',
    '--schema=public',
    '--no-owner',
    '--no-privileges',
    '--no-publications',
    '--no-subscriptions',
    ORIGEM!,
  ]);
  // O public já existe no Supabase novo.
  const limpo = dump
    .split('\n')
    .filter((l) => !/^CREATE SCHEMA public;|^COMMENT ON SCHEMA public /.test(l))
    .join('\n');
  const dir = mkdtempSync(resolve(tmpdir(), 'concilia-clientes-'));
  const arq = resolve(dir, 'schema.sql');
  writeFileSync(arq, limpo);
  console.log(`  aplicando no destino (${(limpo.length / 1024).toFixed(0)} KB)...`);
  rodar('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-d', DESTINO!, '-f', arq]);
}

async function catalogo() {
  const perms = await src`select id, codigo, modulo, acao, descricao, escopo from permissao`;
  for (const p of perms) {
    await dst`
      insert into permissao (id, codigo, modulo, acao, descricao, escopo)
      values (${p.id}, ${p.codigo}, ${p.modulo}, ${p.acao}, ${p.descricao}, ${p.escopo})
      on conflict (codigo) do update set modulo = excluded.modulo, acao = excluded.acao,
        descricao = excluded.descricao, escopo = excluded.escopo`;
  }
  console.log(`  permissões: ${perms.length}`);

  // Grupos-modelo do sistema (organizacao_id null), um por nome — o mais
  // completo. 'Admin' NÃO vem: ehAdmin() é global e veria todas as empresas.
  const grupos = await src<{ id: string; nome: string; descricao: string | null }[]>`
    select distinct on (g.nome) g.id, g.nome, g.descricao
      from grupo_usuario g
     where g.organizacao_id is null and g.nome <> 'Admin'
     order by g.nome, (select count(*) from grupo_permissao gp where gp.grupo_id = g.id) desc`;
  for (const g of grupos) {
    const [ja] = await dst<{ id: string }[]>`
      select id from grupo_usuario where organizacao_id is null and nome = ${g.nome} limit 1`;
    const id =
      ja?.id ??
      (
        await dst<{ id: string }[]>`
          insert into grupo_usuario (nome, descricao, sistema) values (${g.nome}, ${g.descricao}, true)
          returning id`
      )[0]!.id;
    const codigos = await src<{ codigo: string }[]>`
      select p.codigo from grupo_permissao gp join permissao p on p.id = gp.permissao_id where gp.grupo_id = ${g.id}`;
    const lista = codigos.map((c) => c.codigo);
    if (lista.length) {
      await dst`
        insert into grupo_permissao (grupo_id, permissao_id)
        select ${id}, p.id from permissao p where p.codigo = any(${lista})
        on conflict do nothing`;
    }
    console.log(`  grupo ${g.nome}: ${lista.length} permissões`);
  }
  const admin = await dst`select id from grupo_usuario where nome = 'Admin'`;
  if (admin.length) console.warn(`  ⚠ o destino tem ${admin.length} grupo(s) 'Admin' — não use na instância dos clientes.`);
}

async function rls() {
  const tabs = await dst<{ t: string }[]>`
    select tablename t from pg_tables where schemaname = 'public' and not rowsecurity`;
  for (const { t } of tabs) await dst.unsafe(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
  console.log(`  RLS ligado em mais ${tabs.length} tabela(s)`);
}

async function main() {
  if (!SO_CATALOGO) await estrutura();
  await catalogo();
  await rls();
  const [{ n }] = await dst<{ n: number }[]>`select count(*)::int n from pg_tables where schemaname='public'`;
  console.log(`Pronto. ${n} tabelas na instância dos clientes.`);
  await src.end();
  await dst.end();
}

main().catch(async (e) => {
  console.error(e);
  await src.end();
  await dst.end();
  process.exit(1);
});
