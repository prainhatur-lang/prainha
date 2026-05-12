// Lista de grupos de usuario (read-only). Detalhes em /configuracoes/grupos/[id].

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { asc, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { podeUsuario } from '@/lib/permissoes-runtime';

export const dynamic = 'force-dynamic';

export default async function GruposPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'grupo_usuario.read');
  const podeCriar = await podeUsuario(user.id, 'grupo_usuario.create');

  const grupos = await db
    .select({
      id: schema.grupoUsuario.id,
      nome: schema.grupoUsuario.nome,
      descricao: schema.grupoUsuario.descricao,
      sistema: schema.grupoUsuario.sistema,
    })
    .from(schema.grupoUsuario)
    .orderBy(asc(schema.grupoUsuario.nome));

  // Conta de permissoes e usuarios por grupo
  const permsCount = await db
    .select({
      grupoId: schema.grupoPermissao.grupoId,
      qtd: sql<number>`COUNT(*)::int`,
    })
    .from(schema.grupoPermissao)
    .groupBy(schema.grupoPermissao.grupoId);
  const permsPorGrupo = new Map(permsCount.map((r) => [r.grupoId, r.qtd]));

  const usersCount = await db
    .select({
      grupoId: schema.usuarioGrupo.grupoId,
      qtd: sql<number>`COUNT(DISTINCT ${schema.usuarioGrupo.usuarioId})::int`,
    })
    .from(schema.usuarioGrupo)
    .groupBy(schema.usuarioGrupo.grupoId);
  const usersPorGrupo = new Map(usersCount.map((r) => [r.grupoId, r.qtd]));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Grupos e permissões</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Grupos pré-prontos do sistema + grupos custom da sua organização.
              Atribua grupos aos usuários em{' '}
              <Link
                href="/configuracoes/usuarios"
                className="text-sky-700 underline-offset-2 hover:underline"
              >
                Usuários
              </Link>
              .
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/configuracoes/grupos/matriz"
              className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Ver matriz de permissões →
            </Link>
            {podeCriar && (
              <Link
                href="/configuracoes/grupos/novo"
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                + Novo grupo
              </Link>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Grupo</th>
                <th className="px-3 py-2 text-left font-medium">Descrição</th>
                <th className="px-3 py-2 text-right font-medium">Permissões</th>
                <th className="px-3 py-2 text-right font-medium">Usuários</th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-900">{g.nome}</span>
                    {g.sistema && (
                      <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[9px] uppercase text-slate-500">
                        sistema
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{g.descricao ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{permsPorGrupo.get(g.id) ?? 0}</td>
                  <td className="px-3 py-2 text-right font-mono">{usersPorGrupo.get(g.id) ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/configuracoes/grupos/${g.id}`}
                      className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
