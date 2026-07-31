// Form pra criar grupo custom — herda permissoes de um grupo de modelo, opcional.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { asc, eq, inArray, isNull } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { NovoGrupoForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NovoGrupoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'grupo_usuario.create');

  // Grupos sistema para escolher modelo (copiar permissoes)
  const modelos = await db
    .select({
      id: schema.grupoUsuario.id,
      nome: schema.grupoUsuario.nome,
      descricao: schema.grupoUsuario.descricao,
    })
    .from(schema.grupoUsuario)
    .where(isNull(schema.grupoUsuario.organizacaoId))
    .orderBy(asc(schema.grupoUsuario.nome));

  // Permissoes em cada modelo (pra mostrar preview)
  const modelosIds = modelos.map((m) => m.id);
  const permsPorModelo = modelosIds.length
    ? await db
        .select({
          grupoId: schema.grupoPermissao.grupoId,
          permissaoId: schema.grupoPermissao.permissaoId,
        })
        .from(schema.grupoPermissao)
        .where(inArray(schema.grupoPermissao.grupoId, modelosIds))
    : [];
  const idsPorModelo: Record<string, string[]> = {};
  for (const r of permsPorModelo) {
    if (!idsPorModelo[r.grupoId]) idsPorModelo[r.grupoId] = [];
    idsPorModelo[r.grupoId]!.push(r.permissaoId);
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-2xl px-6 py-6">
        <h1 className="text-xl font-semibold text-slate-900">Novo grupo custom</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Crie um grupo com permissões customizadas. Opcionalmente copie de um grupo
          de modelo pra começar. Depois ajuste na matriz.
        </p>
        <NovoGrupoForm modelos={modelos} idsPorModelo={idsPorModelo} />
      </div>
    </main>
  );
}
