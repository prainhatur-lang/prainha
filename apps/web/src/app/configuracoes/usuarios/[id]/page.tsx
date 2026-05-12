// Detalhe + edicao de um usuario: muda grupos por filial, troca senha, remove.

import { redirect, notFound } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { asc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { EditarUsuarioForm } from './form';

export const dynamic = 'force-dynamic';

export default async function EditarUsuarioPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'usuario.update');

  const [target] = await db
    .select({
      id: schema.usuario.id,
      email: schema.usuario.email,
      criadoEm: schema.usuario.criadoEm,
    })
    .from(schema.usuario)
    .where(eq(schema.usuario.id, id))
    .limit(1);
  if (!target) notFound();

  const filiais = await filiaisDoUsuario(user.id);
  const grupos = await db
    .select({
      id: schema.grupoUsuario.id,
      nome: schema.grupoUsuario.nome,
      descricao: schema.grupoUsuario.descricao,
      sistema: schema.grupoUsuario.sistema,
    })
    .from(schema.grupoUsuario)
    .orderBy(asc(schema.grupoUsuario.nome));

  // Vinculos atuais
  const vinculosUF = await db
    .select({
      filialId: schema.usuarioFilial.filialId,
      role: schema.usuarioFilial.role,
    })
    .from(schema.usuarioFilial)
    .where(eq(schema.usuarioFilial.usuarioId, id));
  const vinculosUG = await db
    .select({
      grupoId: schema.usuarioGrupo.grupoId,
      filialId: schema.usuarioGrupo.filialId,
    })
    .from(schema.usuarioGrupo)
    .where(eq(schema.usuarioGrupo.usuarioId, id));

  // Monta state inicial: pra cada filial do alvo, lista de grupos
  const vinculosIniciais = vinculosUF.map((uf) => ({
    filialId: uf.filialId,
    grupoIds: vinculosUG
      .filter((ug) => ug.filialId === uf.filialId)
      .map((ug) => ug.grupoId),
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-xl font-semibold text-slate-900">{target.email}</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Criado em {new Date(target.criadoEm).toLocaleDateString('pt-BR')}
        </p>
        <EditarUsuarioForm
          usuarioId={target.id}
          email={target.email}
          ehProprio={target.id === user.id}
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          grupos={grupos}
          vinculosIniciais={vinculosIniciais}
        />
      </div>
    </main>
  );
}
