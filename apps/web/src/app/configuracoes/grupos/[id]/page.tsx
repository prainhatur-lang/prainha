// Detalhe de um grupo: lista de permissoes agrupadas por modulo.

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { asc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { BotaoApagarGrupo } from './apagar';
import { EditarMetaGrupo } from './editar-meta';

export const dynamic = 'force-dynamic';

export default async function GrupoDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'grupo_usuario.read');
  const podeDeletar = await podeUsuario(user.id, 'grupo_usuario.delete');
  const podeEditar = await podeUsuario(user.id, 'grupo_usuario.update');

  const [grupo] = await db
    .select()
    .from(schema.grupoUsuario)
    .where(eq(schema.grupoUsuario.id, id))
    .limit(1);
  if (!grupo) notFound();

  const perms = await db
    .select({
      codigo: schema.permissao.codigo,
      modulo: schema.permissao.modulo,
      acao: schema.permissao.acao,
      descricao: schema.permissao.descricao,
    })
    .from(schema.grupoPermissao)
    .innerJoin(schema.permissao, eq(schema.permissao.id, schema.grupoPermissao.permissaoId))
    .where(eq(schema.grupoPermissao.grupoId, id))
    .orderBy(asc(schema.permissao.modulo), asc(schema.permissao.acao));

  // Agrupa por modulo
  const porModulo = new Map<string, typeof perms>();
  for (const p of perms) {
    if (!porModulo.has(p.modulo)) porModulo.set(p.modulo, [] as typeof perms);
    porModulo.get(p.modulo)!.push(p);
  }

  // Usuarios atualmente nesse grupo (com filial onde se aplica)
  const usuariosNoGrupo = await db
    .select({
      usuarioId: schema.usuarioGrupo.usuarioId,
      filialId: schema.usuarioGrupo.filialId,
      email: schema.usuario.email,
      filialNome: schema.filial.nome,
    })
    .from(schema.usuarioGrupo)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.usuarioGrupo.usuarioId))
    .leftJoin(schema.filial, eq(schema.filial.id, schema.usuarioGrupo.filialId))
    .where(eq(schema.usuarioGrupo.grupoId, id))
    .orderBy(asc(schema.usuario.email));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-4">
          <Link
            href="/configuracoes/grupos"
            className="text-xs text-sky-700 underline-offset-2 hover:underline"
          >
            ← Voltar para grupos
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">
            {grupo.nome}
            {grupo.sistema && (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                sistema
              </span>
            )}
          </h1>
          {grupo.descricao && (
            <p className="mt-0.5 text-xs text-slate-500">{grupo.descricao}</p>
          )}
          <p className="mt-1 text-[11px] text-slate-500">
            {perms.length} permissão(ões) em {porModulo.size} módulo(s).
          </p>
        </div>

        {grupo.sistema ? (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
            Este é um grupo do sistema. As permissões são definidas pelo catálogo e
            não podem ser editadas pela UI.
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
            <div className="flex items-center justify-between gap-3">
              <p>
                Grupo custom — você pode editar as permissões na{' '}
                <Link
                  href="/configuracoes/grupos/matriz"
                  className="underline underline-offset-2"
                >
                  matriz
                </Link>
                .
              </p>
              {podeDeletar && <BotaoApagarGrupo id={grupo.id} nome={grupo.nome} />}
            </div>
            {podeEditar && (
              <div className="mt-2 border-t border-emerald-200 pt-2">
                <EditarMetaGrupo
                  id={grupo.id}
                  nomeAtual={grupo.nome}
                  descricaoAtual={grupo.descricao}
                />
              </div>
            )}
          </div>
        )}

        {/* Usuarios neste grupo */}
        <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Usuários neste grupo
            </span>
            <span className="text-[11px] text-slate-500">
              {usuariosNoGrupo.length} vínculo(s)
            </span>
          </div>
          {usuariosNoGrupo.length === 0 ? (
            <p className="px-3 py-4 text-xs italic text-slate-500">
              Nenhum usuário vinculado a este grupo.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs">
              {usuariosNoGrupo.map((u, i) => (
                <li
                  key={`${u.usuarioId}-${u.filialId ?? 'all'}-${i}`}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <Link
                    href={`/configuracoes/usuarios/${u.usuarioId}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {u.email}
                  </Link>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                    {u.filialNome ?? 'todas as filiais'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          {[...porModulo.entries()].map(([modulo, lista]) => (
            <div
              key={modulo}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {modulo}
              </div>
              <ul className="divide-y divide-slate-100 text-xs">
                {lista.map((p) => (
                  <li key={p.codigo} className="flex items-start justify-between px-3 py-2">
                    <div>
                      <span className="font-mono text-[11px] text-slate-700">
                        {p.codigo}
                      </span>
                      {p.descricao && (
                        <p className="mt-0.5 text-[11px] text-slate-500">{p.descricao}</p>
                      )}
                    </div>
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-800">
                      {p.acao}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
