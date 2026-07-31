// Listagem de usuarios da organizacao + seus grupos por filial.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

export default async function UsuariosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'usuario.read');

  const filiais = await filiaisDoUsuario(user.id);
  const filiaisIds = filiais.map((f) => f.id);
  if (filiaisIds.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  // Carrega todos usuarios que tem vinculo em ALGUMA filial que o user atual ve
  const usuariosLinks = await db
    .select({
      usuarioId: schema.usuarioFilial.usuarioId,
      filialId: schema.usuarioFilial.filialId,
      role: schema.usuarioFilial.role,
    })
    .from(schema.usuarioFilial)
    .where(inArray(schema.usuarioFilial.filialId, filiaisIds));

  const usuariosIds = [...new Set(usuariosLinks.map((u) => u.usuarioId))];
  const usuarios = usuariosIds.length
    ? await db
        .select({
          id: schema.usuario.id,
          email: schema.usuario.email,
          criadoEm: schema.usuario.criadoEm,
        })
        .from(schema.usuario)
        .where(inArray(schema.usuario.id, usuariosIds))
        .orderBy(asc(schema.usuario.email))
    : [];

  // Grupos por usuario
  const grupos = usuariosIds.length
    ? await db
        .select({
          usuarioId: schema.usuarioGrupo.usuarioId,
          grupoNome: schema.grupoUsuario.nome,
          filialId: schema.usuarioGrupo.filialId,
        })
        .from(schema.usuarioGrupo)
        .innerJoin(schema.grupoUsuario, eq(schema.grupoUsuario.id, schema.usuarioGrupo.grupoId))
        .where(inArray(schema.usuarioGrupo.usuarioId, usuariosIds))
    : [];
  const gruposPorUsuario = new Map<string, string[]>();
  for (const g of grupos) {
    if (!gruposPorUsuario.has(g.usuarioId)) gruposPorUsuario.set(g.usuarioId, []);
    const escopo = g.filialId ? filiais.find((f) => f.id === g.filialId)?.nome ?? '?' : 'todas';
    gruposPorUsuario.get(g.usuarioId)!.push(`${g.grupoNome} (${escopo})`);
  }

  // Filiais vinculadas por usuario
  const filiaisPorUsuario = new Map<string, string[]>();
  for (const link of usuariosLinks) {
    if (!filiaisPorUsuario.has(link.usuarioId)) filiaisPorUsuario.set(link.usuarioId, []);
    const fNome = filiais.find((f) => f.id === link.filialId)?.nome ?? '?';
    filiaisPorUsuario.get(link.usuarioId)!.push(`${fNome} [${link.role}]`);
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Usuários</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {usuarios.length} usuários com acesso à(s) filial(is) que você administra.
            </p>
          </div>
          <Link
            href="/configuracoes/usuarios/novo"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            + Novo usuário
          </Link>
        </div>

        <div className="mb-4 text-xs">
          <Link
            href="/configuracoes/grupos"
            className="text-sky-700 underline-offset-2 hover:underline"
          >
            Ver grupos e permissões →
          </Link>
        </div>

        {usuarios.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            Nenhum usuário cadastrado. Clique em <strong>+ Novo usuário</strong>.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Email</th>
                  <th className="px-3 py-2 text-left font-medium">Filiais (role legado)</th>
                  <th className="px-3 py-2 text-left font-medium">Grupos</th>
                  <th className="px-3 py-2 text-left font-medium">Criado</th>
                  <th className="px-3 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">{u.email}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {(filiaisPorUsuario.get(u.id) ?? []).map((f) => (
                        <span
                          key={f}
                          className="mr-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px]"
                        >
                          {f}
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-2">
                      {(gruposPorUsuario.get(u.id) ?? []).length === 0 ? (
                        <span className="text-[10px] italic text-slate-400">sem grupos</span>
                      ) : (
                        (gruposPorUsuario.get(u.id) ?? []).map((g) => (
                          <span
                            key={g}
                            className="mr-1 inline-block rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800"
                          >
                            {g}
                          </span>
                        ))
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {new Date(u.criadoEm).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/configuracoes/usuarios/${u.id}`}
                        className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Editar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
