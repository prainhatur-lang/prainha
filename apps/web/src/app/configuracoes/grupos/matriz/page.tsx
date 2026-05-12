// Matriz visual de permissoes × grupos. Sistema groups sao read-only,
// grupos custom (organizacao do user) podem ser editados.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { filiaisDoUsuario } from '@/lib/filiais';
import { MatrizEditor } from './editor';

export const dynamic = 'force-dynamic';

export default async function MatrizPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'grupo_usuario.read');

  // Descobre organizacao do usuario (via filiais)
  const filiais = await filiaisDoUsuario(user.id);
  const orgIds = [
    ...new Set(
      await db
        .select({ id: schema.filial.organizacaoId })
        .from(schema.filial)
        .where(inArray(schema.filial.id, filiais.map((f) => f.id)))
        .then((rs) => rs.map((r) => r.id)),
    ),
  ];

  // Pode editar grupos custom se tiver grupo_usuario.update
  const { podeUsuario } = await import('@/lib/permissoes-runtime');
  const podeEditar = await podeUsuario(user.id, 'grupo_usuario.update');
  const podeCriar = await podeUsuario(user.id, 'grupo_usuario.create');

  // Carrega todas permissoes
  const perms = await db
    .select({
      id: schema.permissao.id,
      codigo: schema.permissao.codigo,
      modulo: schema.permissao.modulo,
      acao: schema.permissao.acao,
      descricao: schema.permissao.descricao,
    })
    .from(schema.permissao)
    .orderBy(asc(schema.permissao.modulo), asc(schema.permissao.acao));

  // Carrega grupos: sistema (org=NULL) + custom da org do user
  const grupos = await db
    .select({
      id: schema.grupoUsuario.id,
      nome: schema.grupoUsuario.nome,
      descricao: schema.grupoUsuario.descricao,
      sistema: schema.grupoUsuario.sistema,
      organizacaoId: schema.grupoUsuario.organizacaoId,
    })
    .from(schema.grupoUsuario)
    .where(
      orgIds.length > 0
        ? or(
            isNull(schema.grupoUsuario.organizacaoId),
            inArray(schema.grupoUsuario.organizacaoId, orgIds),
          )
        : isNull(schema.grupoUsuario.organizacaoId),
    )
    .orderBy(asc(schema.grupoUsuario.sistema), asc(schema.grupoUsuario.nome));

  // Carrega cruzamentos (apenas dos grupos relevantes)
  const grupoIds = grupos.map((g) => g.id);
  const cruzamentos = grupoIds.length
    ? await db
        .select({
          grupoId: schema.grupoPermissao.grupoId,
          permissaoId: schema.grupoPermissao.permissaoId,
        })
        .from(schema.grupoPermissao)
        .where(inArray(schema.grupoPermissao.grupoId, grupoIds))
    : [];

  // Set de "grupoId|permId" pra lookup
  const marcadas: Record<string, boolean> = {};
  for (const c of cruzamentos) {
    marcadas[`${c.grupoId}|${c.permissaoId}`] = true;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-[100rem] px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Matriz de permissões</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {perms.length} permissões × {grupos.length} grupos. Grupos do sistema
              são read-only.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/configuracoes/grupos"
              className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              ← Lista de grupos
            </Link>
            {podeCriar && orgIds[0] && (
              <Link
                href="/configuracoes/grupos/novo"
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                + Novo grupo custom
              </Link>
            )}
          </div>
        </div>

        <MatrizEditor
          perms={perms}
          grupos={grupos}
          marcadasIniciais={marcadas}
          podeEditar={podeEditar}
        />
      </div>
    </main>
  );
}
